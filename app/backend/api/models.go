package api

import "time"

type Header struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type EnvironmentValue struct {
	Text string `json:"text"`
	Type string `json:"type"`
}

type RequestInput struct {
	ID          string                      `json:"id"`
	Name        string                      `json:"name"`
	Method      string                      `json:"method"`
	URL         string                      `json:"url"`
	QueryParams []Header                    `json:"queryParams"`
	Headers     []Header                    `json:"headers"`
	BodyType    string                      `json:"bodyType"`
	Body        string                      `json:"body"`
	Auth        map[string]string           `json:"auth"`
	Tests       string                      `json:"tests"`
	Environment map[string]EnvironmentValue `json:"environment"`
	TimeoutMS   int                         `json:"timeoutMs"`
}

type SentRequest struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

type ResponseOutput struct {
	StatusCode  int               `json:"statusCode"`
	Status      string            `json:"status"`
	Headers     map[string]string `json:"headers"`
	Body        string            `json:"body"`
	BodySize    int64             `json:"bodySize"`
	DurationMS  int64             `json:"durationMs"`
	ReceivedAt  time.Time         `json:"receivedAt"`
	Error       string            `json:"error,omitempty"`
	ResolvedURL string            `json:"resolvedUrl"`
	Sent        *SentRequest      `json:"sent,omitempty"`
}

type Collection struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	ParentID  string        `json:"parentId"`
	Kind      string        `json:"kind"`
	Method    string        `json:"method,omitempty"`
	URL       string        `json:"url,omitempty"`
	Tags      []string      `json:"tags"`
	Favorite  bool          `json:"favorite"`
	Request   *RequestInput `json:"request,omitempty"`
	CreatedAt time.Time     `json:"createdAt"`
	UpdatedAt time.Time     `json:"updatedAt"`
}

type Environment struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Variables map[string]string `json:"variables"`
	Secrets   []string          `json:"secrets"`
	Active    bool              `json:"active"`
}

type HistoryEntry struct {
	ID        string         `json:"id"`
	Request   RequestInput   `json:"request"`
	Response  ResponseOutput `json:"response"`
	CreatedAt time.Time      `json:"createdAt"`
}

type SnippetRequest struct {
	Language string       `json:"language"`
	Request  RequestInput `json:"request"`
}

type WorkspaceBootstrap struct {
	Collections  []Collection   `json:"collections"`
	Environments []Environment  `json:"environments"`
	History      []HistoryEntry `json:"history"`
}
