package api

import (
	"encoding/json"
	"time"
)

type Header struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type EnvironmentValue struct {
	Text     string `json:"text"`
	Type     string `json:"type"`
	FileName string `json:"fileName,omitempty"`
}

// UnmarshalJSON accepts both the structured form {"text":"…","type":"text"} and a bare
// string "…". Older exports and some imported collections store variables as plain strings,
// so tolerating both keeps SaveCollection from rejecting the whole request.
func (e *EnvironmentValue) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		e.Text = text
		e.Type = "text"
		return nil
	}
	type alias EnvironmentValue
	var value alias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*e = EnvironmentValue(value)
	return nil
}

type RequestInput struct {
	ID               string                      `json:"id"`
	Name             string                      `json:"name"`
	Method           string                      `json:"method"`
	URL              string                      `json:"url"`
	QueryParams      []Header                    `json:"queryParams"`
	Headers          []Header                    `json:"headers"`
	BodyType         string                      `json:"bodyType"`
	Body             string                      `json:"body"`
	Auth             map[string]string           `json:"auth"`
	PreRequestScript string                      `json:"preRequestScript"`
	Tests            string                      `json:"tests"`
	Environment      map[string]EnvironmentValue `json:"environment"`
	TimeoutMS        int                         `json:"timeoutMs"`
	// Network settings. Pointers so a missing value means "use the safe default" (follow
	// redirects, verify TLS) rather than Go's zero value of false.
	FollowRedirects *bool `json:"followRedirects,omitempty"`
	VerifySSL       *bool `json:"verifySSL,omitempty"`
}

type FilePick struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type Cookie struct {
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Name     string `json:"name"`
	Value    string `json:"value"`
	Expires  string `json:"expires"`
	Secure   bool   `json:"secure"`
	HTTPOnly bool   `json:"httpOnly"`
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
	Tags      []string                    `json:"tags"`
	Favorite  bool                        `json:"favorite"`
	Request   *RequestInput               `json:"request,omitempty"`
	Variables map[string]EnvironmentValue `json:"variables,omitempty"`
	CreatedAt time.Time                   `json:"createdAt"`
	UpdatedAt time.Time                   `json:"updatedAt"`
}

type Environment struct {
	ID        string                      `json:"id"`
	Name      string                      `json:"name"`
	Variables map[string]EnvironmentValue `json:"variables"`
	Secrets   []string                    `json:"secrets"`
	Active    bool                        `json:"active"`
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
