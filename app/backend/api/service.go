package api

import (
	"bytes"
	"context"
	"crypto/tls"
	crand "crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	grpcclient "github.com/omurilo/yarc/app/backend/grpc"
	"github.com/omurilo/yarc/app/backend/storage"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type AppService struct {
	db *sql.DB
	// streams maps an in-flight stream id to its context.CancelFunc so it can be aborted.
	streams sync.Map
	// wsConns maps an open WebSocket connection id to its live connection handle.
	wsConns sync.Map
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

// clientFor builds an HTTP client honoring the request's network settings. Defaults (nil
// pointers) follow redirects and verify TLS. A new client per request keeps settings isolated.
func clientFor(input RequestInput) *http.Client {
	follow := input.FollowRedirects == nil || *input.FollowRedirects
	verify := input.VerifySSL == nil || *input.VerifySSL
	client := &http.Client{
		Transport: &http.Transport{
			Proxy:           http.ProxyFromEnvironment,
			TLSClientConfig: &tls.Config{InsecureSkipVerify: !verify},
		},
	}
	if !follow {
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	return client
}

// ListCookies / SaveCookie / DeleteCookie / ClearCookies back the cookie manager UI.
func (s *AppService) ListCookies() []Cookie {
	stored, err := storage.ListCookies(s.db)
	if err != nil {
		return []Cookie{}
	}
	cookies := make([]Cookie, 0, len(stored))
	for _, c := range stored {
		cookies = append(cookies, Cookie{Domain: c.Domain, Path: c.Path, Name: c.Name, Value: c.Value, Expires: c.Expires, Secure: c.Secure, HTTPOnly: c.HTTPOnly})
	}
	return cookies
}

func (s *AppService) SaveCookie(c Cookie) error {
	return storage.UpsertCookie(s.db, storage.StoredCookie{Domain: c.Domain, Path: c.Path, Name: c.Name, Value: c.Value, Expires: c.Expires, Secure: c.Secure, HTTPOnly: c.HTTPOnly})
}

func (s *AppService) DeleteCookie(domain, path, name string) error {
	return storage.DeleteCookie(s.db, domain, path, name)
}

func (s *AppService) ClearCookies(domain string) error {
	return storage.ClearCookies(s.db, domain)
}

// attachCookies adds stored cookies that match the request URL to the Cookie header. User-set
// cookies (an existing Cookie header) win on name conflicts.
func (s *AppService) attachCookies(req *http.Request) {
	stored, err := storage.ListCookies(s.db)
	if err != nil || len(stored) == 0 {
		return
	}
	host := req.URL.Hostname()
	reqPath := req.URL.Path
	if reqPath == "" {
		reqPath = "/"
	}
	now := time.Now()

	pairs := map[string]string{}
	order := []string{}
	add := func(name, value string) {
		if _, seen := pairs[name]; !seen {
			order = append(order, name)
		}
		pairs[name] = value
	}
	// Seed with any user-provided cookies so they take precedence.
	for _, existing := range req.Cookies() {
		add(existing.Name, existing.Value)
	}
	for _, c := range stored {
		if !cookieDomainMatch(host, c.Domain) || !strings.HasPrefix(reqPath, normalizeCookiePath(c.Path)) {
			continue
		}
		if c.Secure && req.URL.Scheme != "https" {
			continue
		}
		if c.Expires != "" {
			if exp, perr := time.Parse(time.RFC3339, c.Expires); perr == nil && exp.Before(now) {
				continue
			}
		}
		if _, userSet := pairs[c.Name]; userSet {
			continue
		}
		add(c.Name, c.Value)
	}
	if len(order) == 0 {
		return
	}
	parts := make([]string, 0, len(order))
	for _, name := range order {
		parts = append(parts, name+"="+pairs[name])
	}
	req.Header.Set("Cookie", strings.Join(parts, "; "))
}

// storeResponseCookies persists Set-Cookie headers from a response (delete on Max-Age<0).
func (s *AppService) storeResponseCookies(reqURL *url.URL, cookies []*http.Cookie) {
	for _, c := range cookies {
		domain := strings.TrimPrefix(c.Domain, ".")
		if domain == "" {
			domain = reqURL.Hostname()
		}
		path := normalizeCookiePath(c.Path)
		if c.MaxAge < 0 {
			_ = storage.DeleteCookie(s.db, domain, path, c.Name)
			continue
		}
		expires := ""
		if !c.Expires.IsZero() {
			expires = c.Expires.UTC().Format(time.RFC3339)
		} else if c.MaxAge > 0 {
			expires = time.Now().Add(time.Duration(c.MaxAge) * time.Second).UTC().Format(time.RFC3339)
		}
		_ = storage.UpsertCookie(s.db, storage.StoredCookie{Domain: domain, Path: path, Name: c.Name, Value: c.Value, Expires: expires, Secure: c.Secure, HTTPOnly: c.HttpOnly})
	}
}

func normalizeCookiePath(path string) string {
	if path == "" {
		return "/"
	}
	return path
}

func cookieDomainMatch(host, domain string) bool {
	domain = strings.TrimPrefix(domain, ".")
	return host == domain || strings.HasSuffix(host, "."+domain)
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
	s.attachCookies(req)
	sent := sentRequestFrom(req, sentBody)

	resp, err := clientFor(input).Do(req)
	if err != nil {
		out := errorResponse(err, start, resolvedURL)
		out.Sent = sent
		return out
	}
	defer resp.Body.Close()
	s.storeResponseCookies(req.URL, resp.Cookies())

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
	s.attachCookies(req)
	sent := sentRequestFrom(req, sentBody)

	resp, err := clientFor(input).Do(req)
	if err != nil {
		emit("done", map[string]any{"error": err.Error(), "resolvedUrl": resolvedURL, "durationMs": time.Since(start).Milliseconds(), "sent": sent})
		return
	}
	defer resp.Body.Close()
	s.storeResponseCookies(req.URL, resp.Cookies())

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
	// pending holds bytes carried over between reads so a multi-byte UTF-8 rune split across
	// the read boundary is never turned into a replacement char (which would corrupt the body).
	var pending []byte
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			total += n
			pending = append(pending, buffer[:n]...)
			if split := utf8SplitPoint(pending); split > 0 {
				chunk := string(pending[:split])
				full.WriteString(chunk)
				emit("chunk", chunk)
				pending = append(pending[:0], pending[split:]...)
			}
		}
		if readErr != nil {
			break
		}
	}
	// Flush any trailing bytes (a final incomplete/invalid rune is emitted as-is).
	if len(pending) > 0 {
		chunk := string(pending)
		full.WriteString(chunk)
		emit("chunk", chunk)
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

// utf8SplitPoint returns the length of the longest prefix of b that ends on a complete UTF-8
// rune boundary, so a trailing partial rune is held back until its remaining bytes arrive.
func utf8SplitPoint(b []byte) int {
	if len(b) == 0 {
		return 0
	}
	// Walk back over continuation bytes (10xxxxxx) to the lead byte of the final rune.
	i := len(b) - 1
	for i >= 0 && i > len(b)-utf8.UTFMax && !utf8.RuneStart(b[i]) {
		i--
	}
	if i < 0 {
		return len(b)
	}
	lead := b[i]
	var need int
	switch {
	case lead < 0x80:
		need = 1
	case lead < 0xE0:
		need = 2
	case lead < 0xF0:
		need = 3
	default:
		need = 4
	}
	if i+need <= len(b) {
		return len(b) // final rune is complete
	}
	return i // hold back the incomplete final rune
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

func storedFromCollection(collection Collection) (storage.StoredCollection, error) {
	tagsJSON, err := json.Marshal(collection.Tags)
	if err != nil {
		return storage.StoredCollection{}, err
	}
	requestJSON := ""
	if collection.Request != nil {
		payload, err := json.Marshal(collection.Request)
		if err != nil {
			return storage.StoredCollection{}, err
		}
		requestJSON = string(payload)
	}
	variablesJSON := ""
	if len(collection.Variables) > 0 {
		payload, err := json.Marshal(collection.Variables)
		if err != nil {
			return storage.StoredCollection{}, err
		}
		variablesJSON = string(payload)
	}
	return storage.StoredCollection{
		ID:            collection.ID,
		ParentID:      collection.ParentID,
		Kind:          collection.Kind,
		Name:          collection.Name,
		Method:        collection.Method,
		URL:           collection.URL,
		TagsJSON:      string(tagsJSON),
		Favorite:      collection.Favorite,
		RequestJSON:   requestJSON,
		VariablesJSON: variablesJSON,
	}, nil
}

func (s *AppService) SaveCollection(collection Collection) error {
	stored, err := storedFromCollection(collection)
	if err != nil {
		return err
	}
	return storage.UpsertCollection(s.db, stored)
}

func (s *AppService) SaveCollections(collections []Collection) error {
	stored := make([]storage.StoredCollection, 0, len(collections))
	for _, collection := range collections {
		item, err := storedFromCollection(collection)
		if err != nil {
			return err
		}
		stored = append(stored, item)
	}
	return storage.UpsertCollections(s.db, stored)
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
		var variables map[string]EnvironmentValue
		if item.VariablesJSON != "" {
			_ = json.Unmarshal([]byte(item.VariablesJSON), &variables)
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
			Variables: variables,
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

func (s *AppService) DeleteEnvironment(id string) error {
	return storage.DeleteEnvironment(s.db, id)
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
	vars := func() map[string]EnvironmentValue {
		return map[string]EnvironmentValue{
			"api_url": {Type: "text"},
			"token":   {Type: "text"},
			"user_id": {Type: "text"},
		}
	}
	return []Environment{
		{ID: "local", Name: "Local", Variables: vars(), Secrets: []string{"token"}, Active: true},
		{ID: "dev", Name: "Dev", Variables: vars(), Secrets: []string{"token"}, Active: false},
		{ID: "staging", Name: "Staging", Variables: vars(), Secrets: []string{"token"}, Active: false},
		{ID: "production", Name: "Production", Variables: vars(), Secrets: []string{"token"}, Active: false},
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
			headers = append(headers, Header{Key: name, Value: "Bearer " + value})
		}
	case "basic":
		encoded := base64.StdEncoding.EncodeToString([]byte(resolveVariables(request.Auth["username"], env) + ":" + resolveVariables(request.Auth["password"], env)))
		headers = append(headers, Header{Key: "Authorization", Value: "Basic " + encoded})
	case "apiKey":
		if request.Auth["addTo"] != "query" && request.Auth["key"] != "" {
			headers = append(headers, Header{Key: resolveVariables(request.Auth["key"], env), Value: resolveVariables(request.Auth["value"], env)})
		}
	case "oauth2":
		if token := resolveVariables(oauthToken(request.Auth), env); token != "" {
			name := request.Auth["headerName"]
			if name == "" {
				name = "Authorization"
			}
			prefix := request.Auth["headerPrefix"]
			if prefix == "" {
				prefix = "Bearer"
			}
			headers = append(headers, Header{Key: name, Value: prefix + " " + token})
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

func resolveVariables(value string, variables map[string]EnvironmentValue) string {
	resolved := value
	keys := make([]string, 0, len(variables))
	for key := range variables {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		placeholder := "{{" + key + "}}"
		if !strings.Contains(resolved, placeholder) {
			continue
		}
		resolved = strings.ReplaceAll(resolved, placeholder, variableValue(variables[key]))
	}
	return applyDynamicVariables(resolved)
}

var dynamicVarRe = regexp.MustCompile(`\{\{\$(\w+)\}\}`)

// applyDynamicVariables resolves Postman-style dynamic placeholders ({{$guid}}, {{$timestamp}}…)
// at send time. Unknown names are left untouched. Each occurrence is generated independently.
func applyDynamicVariables(value string) string {
	if !strings.Contains(value, "{{$") {
		return value
	}
	return dynamicVarRe.ReplaceAllStringFunc(value, func(match string) string {
		name := dynamicVarRe.FindStringSubmatch(match)[1]
		if out, ok := dynamicValue(name); ok {
			return out
		}
		return match
	})
}

func dynamicValue(name string) (string, bool) {
	firstNames := []string{"Ada", "Linus", "Grace", "Alan", "Dennis", "Margaret", "Ken", "Barbara"}
	lastNames := []string{"Lovelace", "Torvalds", "Hopper", "Turing", "Ritchie", "Hamilton", "Thompson", "Liskov"}
	switch name {
	case "guid", "randomUUID":
		return newUUIDv4(), true
	case "timestamp":
		return fmt.Sprintf("%d", time.Now().Unix()), true
	case "isoTimestamp":
		return time.Now().UTC().Format(time.RFC3339), true
	case "randomInt":
		return fmt.Sprintf("%d", rand.Intn(1001)), true
	case "randomBoolean":
		return fmt.Sprintf("%t", rand.Intn(2) == 1), true
	case "randomFirstName":
		return firstNames[rand.Intn(len(firstNames))], true
	case "randomLastName":
		return lastNames[rand.Intn(len(lastNames))], true
	case "randomFullName":
		return firstNames[rand.Intn(len(firstNames))] + " " + lastNames[rand.Intn(len(lastNames))], true
	case "randomEmail":
		return fmt.Sprintf("%s.%s%d@example.com", strings.ToLower(firstNames[rand.Intn(len(firstNames))]), strings.ToLower(lastNames[rand.Intn(len(lastNames))]), rand.Intn(1000)), true
	case "randomUserName":
		return fmt.Sprintf("%s_%d", strings.ToLower(firstNames[rand.Intn(len(firstNames))]), rand.Intn(1000)), true
	case "randomColor":
		return []string{"red", "green", "blue", "yellow", "purple", "cyan"}[rand.Intn(6)], true
	default:
		return "", false
	}
}

func newUUIDv4() string {
	b := make([]byte, 16)
	_, _ = crand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// variableValue returns the substitution for a variable. File-backed variables store a path
// in Text and are read from disk on every use, so the request always reflects the current file
// contents (an empty string if the file is missing/unreadable).
func variableValue(value EnvironmentValue) string {
	if value.Type == "file" && value.Text != "" {
		if data, err := os.ReadFile(value.Text); err == nil {
			return string(data)
		}
		return ""
	}
	return value.Text
}

// SaveResponseFile opens a native save dialog and writes content to the chosen path. Returns
// true if written (false if cancelled/failed). WKWebView ignores anchor/blob downloads, so the
// frontend routes "download response" through here.
func (s *AppService) SaveResponseFile(name string, content string) bool {
	app := application.Get()
	if app == nil {
		return false
	}
	path, err := app.Dialog.SaveFile().SetFilename(name).PromptForSingleSelection()
	if err != nil || path == "" {
		return false
	}
	return os.WriteFile(path, []byte(content), 0o644) == nil
}

// PickFile opens a native file picker and returns the selected path (and its base name), for
// linking an environment variable to a file on disk.
func (s *AppService) PickFile() FilePick {
	app := application.Get()
	if app == nil {
		return FilePick{}
	}
	path, err := app.Dialog.OpenFile().
		CanChooseFiles(true).
		SetTitle("Link a file to this variable").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return FilePick{}
	}
	return FilePick{Path: path, Name: filepath.Base(path)}
}

func applyQueryParams(rawURL string, params []Header, variables map[string]EnvironmentValue) string {
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

func applyQueryAuth(rawURL string, auth map[string]string, variables map[string]EnvironmentValue) string {
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

func applyHeaderAuth(req *http.Request, auth map[string]string, variables map[string]EnvironmentValue) {
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
	case "oauth2":
		token := resolveVariables(oauthToken(auth), variables)
		if token != "" {
			name := auth["headerName"]
			if name == "" {
				name = "Authorization"
			}
			prefix := auth["headerPrefix"]
			if prefix == "" {
				prefix = "Bearer"
			}
			req.Header.Set(name, prefix+" "+token)
		}
	}
}

// oauthToken returns the fetched OAuth 2.0 access token. It deliberately does NOT fall back to
// the bearer "token" field, so a leftover bearer token from a prior auth type can't leak in.
func oauthToken(auth map[string]string) string {
	return auth["accessToken"]
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
