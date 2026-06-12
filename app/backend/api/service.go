package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	grpcclient "github.com/flash/yarc/app/backend/grpc"
	"github.com/flash/yarc/app/backend/storage"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type AppService struct {
	db *sql.DB
	// streams maps an in-flight stream id to its context.CancelFunc so it can be aborted.
	streams sync.Map
}

func NewAppService(db *sql.DB) *AppService {
	_ = storage.EnsureWorkspace(db)
	return &AppService{db: db}
}

func (s *AppService) BootstrapWorkspace() WorkspaceBootstrap {
	return WorkspaceBootstrap{
		Collections:  s.ListCollections(),
		Environments: s.ListEnvironments(),
		History:      s.ListHistory(""),
	}
}

func requestTimeout(input RequestInput) time.Duration {
	if input.TimeoutMS > 0 {
		return time.Duration(input.TimeoutMS) * time.Millisecond
	}
	return 30 * time.Second
}

// buildHTTPRequest resolves the request (variables, query params, auth, content-type) and returns
// the prepared *http.Request, the resolved URL, and the resolved body string.
func buildHTTPRequest(ctx context.Context, input RequestInput) (*http.Request, string, string, error) {
	resolvedURL := resolveVariables(input.URL, input.Environment)
	resolvedURL = applyQueryParams(resolvedURL, input.QueryParams, input.Environment)
	resolvedURL = applyQueryAuth(resolvedURL, input.Auth, input.Environment)

	var bodyReader io.Reader
	sentBody := ""
	if input.Body != "" && methodAllowsBody(input.Method) {
		sentBody = resolveVariables(input.Body, input.Environment)
		bodyReader = bytes.NewBufferString(sentBody)
	}

	req, err := http.NewRequestWithContext(ctx, strings.ToUpper(input.Method), resolvedURL, bodyReader)
	if err != nil {
		return nil, resolvedURL, "", err
	}

	for _, header := range input.Headers {
		if header.Enabled && header.Key != "" {
			req.Header.Set(header.Key, resolveVariables(header.Value, input.Environment))
		}
	}
	applyHeaderAuth(req, input.Auth, input.Environment)

	if input.Body != "" && req.Header.Get("Content-Type") == "" {
		switch input.BodyType {
		case "json":
			req.Header.Set("Content-Type", "application/json")
		case "xml":
			req.Header.Set("Content-Type", "application/xml")
		case "form":
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		default:
			req.Header.Set("Content-Type", "text/plain")
		}
	}

	return req, resolvedURL, sentBody, nil
}

func sentRequestFrom(req *http.Request, sentBody string) *SentRequest {
	headers := make(map[string]string, len(req.Header))
	for key, values := range req.Header {
		headers[key] = strings.Join(values, ", ")
	}
	return &SentRequest{Method: req.Method, URL: req.URL.String(), Headers: headers, Body: sentBody}
}

func headerMap(header http.Header) map[string]string {
	out := make(map[string]string, len(header))
	for key, values := range header {
		out[key] = strings.Join(values, ", ")
	}
	return out
}

func (s *AppService) ExecuteHTTPRequest(input RequestInput) ResponseOutput {
	start := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout(input))
	defer cancel()

	req, resolvedURL, sentBody, err := buildHTTPRequest(ctx, input)
	if err != nil {
		return errorResponse(err, start, resolvedURL)
	}
	sent := sentRequestFrom(req, sentBody)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		out := errorResponse(err, start, resolvedURL)
		out.Sent = sent
		return out
	}
	defer resp.Body.Close()

	responseBody, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		out := errorResponse(readErr, start, resolvedURL)
		out.Sent = sent
		return out
	}

	output := ResponseOutput{
		StatusCode:  resp.StatusCode,
		Status:      resp.Status,
		Headers:     headerMap(resp.Header),
		Body:        string(responseBody),
		BodySize:    int64(len(responseBody)),
		DurationMS:  time.Since(start).Milliseconds(),
		ReceivedAt:  time.Now(),
		ResolvedURL: resolvedURL,
		Sent:        sent,
	}

	s.recordHistory(input, output)
	return output
}

func (s *AppService) recordHistory(input RequestInput, output ResponseOutput) {
	requestJSON, requestErr := json.Marshal(input)
	responseJSON, responseErr := json.Marshal(output)
	if requestErr == nil && responseErr == nil {
		_ = storage.InsertHistory(s.db, input.Method, input.URL, string(requestJSON), string(responseJSON), output.StatusCode, output.DurationMS)
	}
}

// ExecuteHTTPStream performs the request and streams the response body to the frontend via
// Wails events: "yarc:stream:<id>:meta", ":chunk" (each body chunk), and ":done". The frontend
// subscribes to those events using streamID before calling this method.
func (s *AppService) ExecuteHTTPStream(streamID string, input RequestInput) {
	start := time.Now()
	app := application.Get()
	emit := func(suffix string, data any) {
		if app != nil {
			app.Event.Emit("yarc:stream:"+streamID+":"+suffix, data)
		}
	}

	// No assumed timeout for streaming: keep the session open until the server ends it
	// (success or error) or the user cancels via CancelHTTPStream.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.streams.Store(streamID, cancel)
	defer s.streams.Delete(streamID)

	req, resolvedURL, sentBody, err := buildHTTPRequest(ctx, input)
	if err != nil {
		emit("done", map[string]any{"error": err.Error(), "resolvedUrl": resolvedURL, "durationMs": time.Since(start).Milliseconds()})
		return
	}
	sent := sentRequestFrom(req, sentBody)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		emit("done", map[string]any{"error": err.Error(), "resolvedUrl": resolvedURL, "durationMs": time.Since(start).Milliseconds(), "sent": sent})
		return
	}
	defer resp.Body.Close()

	emit("meta", map[string]any{
		"statusCode":  resp.StatusCode,
		"status":      resp.Status,
		"headers":     headerMap(resp.Header),
		"resolvedUrl": resolvedURL,
		"sent":        sent,
	})

	buffer := make([]byte, 16*1024)
	total := 0
	var full strings.Builder
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			chunk := string(buffer[:n])
			total += n
			full.WriteString(chunk)
			emit("chunk", chunk)
		}
		if readErr != nil {
			break
		}
	}

	emit("done", map[string]any{"bodySize": total, "durationMs": time.Since(start).Milliseconds(), "cancelled": ctx.Err() != nil})

	s.recordHistory(input, ResponseOutput{
		StatusCode:  resp.StatusCode,
		Status:      resp.Status,
		Headers:     headerMap(resp.Header),
		Body:        full.String(),
		BodySize:    int64(total),
		DurationMS:  time.Since(start).Milliseconds(),
		ReceivedAt:  time.Now(),
		ResolvedURL: resolvedURL,
		Sent:        sent,
	})
}

// CancelHTTPStream aborts an in-flight streaming request started by ExecuteHTTPStream.
func (s *AppService) CancelHTTPStream(streamID string) {
	if value, ok := s.streams.Load(streamID); ok {
		if cancel, ok := value.(context.CancelFunc); ok {
			cancel()
		}
	}
}

func (s *AppService) ListHistory(query string) []HistoryEntry {
	stored, err := storage.ListHistory(s.db, query)
	if err != nil {
		return []HistoryEntry{}
	}
	entries := make([]HistoryEntry, 0, len(stored))
	for _, item := range stored {
		var entry HistoryEntry
		entry.ID = item.ID
		_ = json.Unmarshal([]byte(item.RequestJSON), &entry.Request)
		_ = json.Unmarshal([]byte(item.ResponseJSON), &entry.Response)
		entry.CreatedAt, _ = time.Parse(time.RFC3339Nano, item.CreatedAt)
		entries = append(entries, entry)
	}
	return entries
}

func (s *AppService) SaveCollection(collection Collection) error {
	tagsJSON, err := json.Marshal(collection.Tags)
	if err != nil {
		return err
	}
	requestJSON := ""
	if collection.Request != nil {
		payload, err := json.Marshal(collection.Request)
		if err != nil {
			return err
		}
		requestJSON = string(payload)
	}

	return storage.UpsertCollection(s.db, storage.StoredCollection{
		ID:          collection.ID,
		ParentID:    collection.ParentID,
		Kind:        collection.Kind,
		Name:        collection.Name,
		Method:      collection.Method,
		URL:         collection.URL,
		TagsJSON:    string(tagsJSON),
		Favorite:    collection.Favorite,
		RequestJSON: requestJSON,
	})
}

func (s *AppService) DeleteCollections(ids []string) error {
	filtered := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != "" && id != "workspace" {
			filtered = append(filtered, id)
		}
	}
	return storage.DeleteCollections(s.db, filtered)
}

func (s *AppService) ListCollections() []Collection {
	stored, err := storage.ListCollections(s.db)
	if err != nil {
		return []Collection{}
	}

	collections := make([]Collection, 0, len(stored))
	for _, item := range stored {
		var tags []string
		_ = json.Unmarshal([]byte(item.TagsJSON), &tags)
		var request *RequestInput
		if item.RequestJSON != "" {
			var parsed RequestInput
			if err := json.Unmarshal([]byte(item.RequestJSON), &parsed); err == nil {
				request = &parsed
			}
		}
		createdAt, _ := time.Parse(time.RFC3339Nano, item.CreatedAt)
		updatedAt, _ := time.Parse(time.RFC3339Nano, item.UpdatedAt)
		collections = append(collections, Collection{
			ID:        item.ID,
			ParentID:  item.ParentID,
			Kind:      item.Kind,
			Method:    item.Method,
			URL:       item.URL,
			Name:      item.Name,
			Tags:      tags,
			Favorite:  item.Favorite,
			Request:   request,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		})
	}
	return collections
}

func (s *AppService) SaveEnvironment(env Environment) error {
	payload, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return storage.UpsertEnvironment(s.db, env.ID, env.Name, string(payload), env.Active)
}

func (s *AppService) ListEnvironments() []Environment {
	payloads, err := storage.ListEnvironments(s.db)
	if err != nil {
		return []Environment{}
	}
	if len(payloads) == 0 {
		envs := defaultEnvironments()
		for _, env := range envs {
			_ = s.SaveEnvironment(env)
		}
		return envs
	}
	envs := make([]Environment, 0, len(payloads))
	for _, payload := range payloads {
		var env Environment
		if err := json.Unmarshal([]byte(payload), &env); err == nil {
			envs = append(envs, env)
		}
	}
	return envs
}

func defaultEnvironments() []Environment {
	return []Environment{
		{ID: "local", Name: "Local", Variables: map[string]string{"api_url": "", "token": "", "user_id": ""}, Secrets: []string{"token"}, Active: true},
		{ID: "dev", Name: "Dev", Variables: map[string]string{"api_url": "", "token": "", "user_id": ""}, Secrets: []string{"token"}, Active: false},
		{ID: "staging", Name: "Staging", Variables: map[string]string{"api_url": "", "token": "", "user_id": ""}, Secrets: []string{"token"}, Active: false},
		{ID: "production", Name: "Production", Variables: map[string]string{"api_url": "", "token": "", "user_id": ""}, Secrets: []string{"token"}, Active: false},
	}
}

type snippetModel struct {
	Method  string
	URL     string
	Headers []Header
	Body    string
	HasBody bool
}

func (s *AppService) GenerateSnippet(input SnippetRequest) string {
	model := buildSnippetModel(input.Request)
	language := strings.ToLower(strings.TrimSpace(input.Language))
	switch language {
	case "curl":
		return curlSnippet(model)
	case "javascript", "js", "typescript", "ts":
		return fetchSnippet(model)
	case "go", "golang":
		return goSnippet(model)
	case "python", "py":
		return pythonSnippet(model)
	case "rust", "rs":
		return rustSnippet(model)
	case "java":
		return javaSnippet(model)
	case "kotlin", "kt":
		return kotlinSnippet(model)
	case "c#", "csharp", "cs":
		return csharpSnippet(model)
	default:
		return curlSnippet(model)
	}
}

func buildSnippetModel(request RequestInput) snippetModel {
	env := request.Environment

	url := resolveVariables(request.URL, env)
	url = applyQueryParams(url, request.QueryParams, env)
	url = applyQueryAuth(url, request.Auth, env)

	headers := make([]Header, 0, len(request.Headers)+1)
	seen := map[string]bool{}
	for _, header := range request.Headers {
		if header.Enabled && header.Key != "" {
			headers = append(headers, Header{Key: header.Key, Value: resolveVariables(header.Value, env)})
			seen[strings.ToLower(header.Key)] = true
		}
	}

	switch request.Auth["type"] {
	case "bearer":
		if value := resolveVariables(request.Auth["token"], env); value != "" {
			name := request.Auth["headerName"]
			if name == "" {
				name = "Authorization"
			}
			headers = append(headers, Header{Key: name, Value: value})
		}
	case "basic":
		encoded := base64.StdEncoding.EncodeToString([]byte(resolveVariables(request.Auth["username"], env) + ":" + resolveVariables(request.Auth["password"], env)))
		headers = append(headers, Header{Key: "Authorization", Value: "Basic " + encoded})
	case "apiKey":
		if request.Auth["addTo"] != "query" && request.Auth["key"] != "" {
			headers = append(headers, Header{Key: resolveVariables(request.Auth["key"], env), Value: resolveVariables(request.Auth["value"], env)})
		}
	}

	hasBody := request.Body != "" && methodAllowsBody(request.Method)
	body := ""
	if hasBody {
		body = resolveVariables(request.Body, env)
		if !seen["content-type"] {
			headers = append(headers, Header{Key: "Content-Type", Value: contentTypeFor(request.BodyType)})
		}
	}

	return snippetModel{
		Method:  strings.ToUpper(request.Method),
		URL:     url,
		Headers: headers,
		Body:    body,
		HasBody: hasBody,
	}
}

func contentTypeFor(bodyType string) string {
	switch bodyType {
	case "json":
		return "application/json"
	case "xml":
		return "application/xml"
	case "form":
		return "application/x-www-form-urlencoded"
	case "multipart":
		return "multipart/form-data"
	default:
		return "text/plain"
	}
}

func contentTypeFromHeaders(model snippetModel) string {
	for _, header := range model.Headers {
		if strings.EqualFold(header.Key, "content-type") {
			return header.Value
		}
	}
	return "application/json"
}

func curlSnippet(model snippetModel) string {
	lines := []string{fmt.Sprintf("curl -X %s %s", model.Method, shellQuote(model.URL))}
	for _, header := range model.Headers {
		lines = append(lines, fmt.Sprintf("  -H %s", shellQuote(header.Key+": "+header.Value)))
	}
	if model.HasBody {
		lines = append(lines, fmt.Sprintf("  -d %s", shellQuote(model.Body)))
	}
	return strings.Join(lines, " \\\n")
}

func fetchSnippet(model snippetModel) string {
	parts := []string{fmt.Sprintf("const response = await fetch(%q, {", model.URL), fmt.Sprintf("  method: %q,", model.Method)}
	if len(model.Headers) > 0 {
		entries := make([]string, 0, len(model.Headers))
		for _, header := range model.Headers {
			entries = append(entries, fmt.Sprintf("    %q: %q,", header.Key, header.Value))
		}
		parts = append(parts, "  headers: {", strings.Join(entries, "\n"), "  },")
	}
	if model.HasBody {
		parts = append(parts, fmt.Sprintf("  body: %q,", model.Body))
	}
	parts = append(parts, "});", "const data = await response.json();", "console.log(data);")
	return strings.Join(parts, "\n")
}

func goSnippet(model snippetModel) string {
	body := "nil"
	if model.HasBody {
		body = fmt.Sprintf("strings.NewReader(%q)", model.Body)
	}
	lines := []string{"package main", "", "import (", "\t\"fmt\"", "\t\"io\"", "\t\"net/http\""}
	if model.HasBody {
		lines = append(lines, "\t\"strings\"")
	}
	lines = append(lines, ")", "", "func main() {", fmt.Sprintf("\treq, _ := http.NewRequest(%q, %q, %s)", model.Method, model.URL, body))
	for _, header := range model.Headers {
		lines = append(lines, fmt.Sprintf("\treq.Header.Set(%q, %q)", header.Key, header.Value))
	}
	lines = append(lines,
		"\tres, err := http.DefaultClient.Do(req)",
		"\tif err != nil {",
		"\t\tpanic(err)",
		"\t}",
		"\tdefer res.Body.Close()",
		"\tbody, _ := io.ReadAll(res.Body)",
		"\tfmt.Println(string(body))",
		"}",
	)
	return strings.Join(lines, "\n")
}

func pythonSnippet(model snippetModel) string {
	lines := []string{"import requests", ""}
	if len(model.Headers) > 0 {
		entries := make([]string, 0, len(model.Headers))
		for _, header := range model.Headers {
			entries = append(entries, fmt.Sprintf("    %q: %q,", header.Key, header.Value))
		}
		lines = append(lines, "headers = {", strings.Join(entries, "\n"), "}")
	}
	if model.HasBody {
		lines = append(lines, fmt.Sprintf("payload = %q", model.Body))
	}
	args := []string{fmt.Sprintf("%q", model.Method), fmt.Sprintf("%q", model.URL)}
	if len(model.Headers) > 0 {
		args = append(args, "headers=headers")
	}
	if model.HasBody {
		args = append(args, "data=payload")
	}
	lines = append(lines, "", fmt.Sprintf("response = requests.request(%s)", strings.Join(args, ", ")), "print(response.text)")
	return strings.Join(lines, "\n")
}

func rustSnippet(model snippetModel) string {
	lines := []string{
		"use reqwest::blocking::Client;",
		"",
		"fn main() -> Result<(), Box<dyn std::error::Error>> {",
		"    let client = Client::new();",
		"    let response = client",
		fmt.Sprintf("        .request(reqwest::Method::%s, %q)", model.Method, model.URL),
	}
	for _, header := range model.Headers {
		lines = append(lines, fmt.Sprintf("        .header(%q, %q)", header.Key, header.Value))
	}
	if model.HasBody {
		lines = append(lines, fmt.Sprintf("        .body(%q)", model.Body))
	}
	lines = append(lines, "        .send()?;", "    println!(\"{}\", response.text()?);", "    Ok(())", "}")
	return strings.Join(lines, "\n")
}

func javaSnippet(model snippetModel) string {
	bodyPublisher := "HttpRequest.BodyPublishers.noBody()"
	if model.HasBody {
		bodyPublisher = fmt.Sprintf("HttpRequest.BodyPublishers.ofString(%q)", model.Body)
	}
	lines := []string{
		"import java.net.URI;",
		"import java.net.http.HttpClient;",
		"import java.net.http.HttpRequest;",
		"import java.net.http.HttpResponse;",
		"",
		"HttpClient client = HttpClient.newHttpClient();",
		"HttpRequest request = HttpRequest.newBuilder()",
		fmt.Sprintf("    .uri(URI.create(%q))", model.URL),
		fmt.Sprintf("    .method(%q, %s)", model.Method, bodyPublisher),
	}
	for _, header := range model.Headers {
		lines = append(lines, fmt.Sprintf("    .header(%q, %q)", header.Key, header.Value))
	}
	lines = append(lines,
		"    .build();",
		"HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());",
		"System.out.println(response.body());",
	)
	return strings.Join(lines, "\n")
}

func kotlinSnippet(model snippetModel) string {
	lines := []string{"import okhttp3.OkHttpClient", "import okhttp3.Request"}
	if model.HasBody {
		lines = append(lines, "import okhttp3.RequestBody.Companion.toRequestBody", "import okhttp3.MediaType.Companion.toMediaType")
	}
	lines = append(lines, "", "val client = OkHttpClient()")
	if model.HasBody {
		lines = append(lines, fmt.Sprintf("val body = %q.toRequestBody(%q.toMediaType())", model.Body, contentTypeFromHeaders(model)))
	}
	requestBody := "null"
	if model.HasBody {
		requestBody = "body"
	}
	lines = append(lines, "val request = Request.Builder()", fmt.Sprintf("    .url(%q)", model.URL), fmt.Sprintf("    .method(%q, %s)", model.Method, requestBody))
	for _, header := range model.Headers {
		lines = append(lines, fmt.Sprintf("    .addHeader(%q, %q)", header.Key, header.Value))
	}
	lines = append(lines, "    .build()", "val response = client.newCall(request).execute()", "println(response.body?.string())")
	return strings.Join(lines, "\n")
}

func csharpSnippet(model snippetModel) string {
	lines := []string{
		"using var client = new HttpClient();",
		fmt.Sprintf("using var request = new HttpRequestMessage(new HttpMethod(%q), %q);", model.Method, model.URL),
	}
	for _, header := range model.Headers {
		if strings.EqualFold(header.Key, "content-type") {
			continue
		}
		lines = append(lines, fmt.Sprintf("request.Headers.TryAddWithoutValidation(%q, %q);", header.Key, header.Value))
	}
	if model.HasBody {
		lines = append(lines, fmt.Sprintf("request.Content = new StringContent(%q, System.Text.Encoding.UTF8, %q);", model.Body, contentTypeFromHeaders(model)))
	}
	lines = append(lines,
		"var response = await client.SendAsync(request);",
		"var body = await response.Content.ReadAsStringAsync();",
		"Console.WriteLine(body);",
	)
	return strings.Join(lines, "\n")
}

func (s *AppService) ListGRPCMethods(req grpcclient.Request) grpcclient.MethodList {
	return grpcclient.ListMethods(context.Background(), req)
}

func (s *AppService) InvokeGRPC(req grpcclient.Request) grpcclient.InvokeResponse {
	return grpcclient.Invoke(context.Background(), req)
}

func resolveVariables(value string, variables map[string]string) string {
	resolved := value
	keys := make([]string, 0, len(variables))
	for key := range variables {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		resolved = strings.ReplaceAll(resolved, "{{"+key+"}}", variables[key])
	}
	return resolved
}

func applyQueryParams(rawURL string, params []Header, variables map[string]string) string {
	if len(params) == 0 {
		return rawURL
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}

	query := parsed.Query()
	for _, param := range params {
		if param.Enabled && param.Key != "" {
			query.Set(param.Key, resolveVariables(param.Value, variables))
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func applyQueryAuth(rawURL string, auth map[string]string, variables map[string]string) string {
	if auth["type"] != "apiKey" || auth["addTo"] != "query" || auth["key"] == "" {
		return rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	query := parsed.Query()
	query.Set(resolveVariables(auth["key"], variables), resolveVariables(auth["value"], variables))
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func applyHeaderAuth(req *http.Request, auth map[string]string, variables map[string]string) {
	switch auth["type"] {
	case "bearer":
		token := resolveVariables(auth["token"], variables)
		if token != "" {
			name := auth["headerName"]
			if name == "" {
				name = "Authorization"
			}
			req.Header.Set(name, "Bearer "+token)
		}
	case "basic":
		req.SetBasicAuth(resolveVariables(auth["username"], variables), resolveVariables(auth["password"], variables))
	case "apiKey":
		if auth["addTo"] != "query" && auth["key"] != "" {
			req.Header.Set(resolveVariables(auth["key"], variables), resolveVariables(auth["value"], variables))
		}
	}
}

func methodAllowsBody(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func shellQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func errorResponse(err error, started time.Time, resolvedURL string) ResponseOutput {
	return ResponseOutput{
		StatusCode:  0,
		Status:      "Request failed",
		Headers:     map[string]string{},
		Body:        "",
		DurationMS:  time.Since(started).Milliseconds(),
		ReceivedAt:  time.Now(),
		Error:       err.Error(),
		ResolvedURL: resolvedURL,
	}
}
