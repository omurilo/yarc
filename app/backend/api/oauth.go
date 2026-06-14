package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type OAuth2Config struct {
	GrantType    string `json:"grantType"`    // client_credentials | password | refresh_token
	TokenURL     string `json:"tokenUrl"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Scope        string `json:"scope"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	RefreshToken string `json:"refreshToken"`
	ClientAuth   string `json:"clientAuth"` // "basic" (Authorization header) | "body" (default)
}

// OAuth2AuthCodeConfig drives the Authorization Code grant, which needs a browser redirect and a
// local callback server. PKCE is used automatically when UsePKCE is true (recommended for public
// clients / clients without a secret).
type OAuth2AuthCodeConfig struct {
	AuthURL      string `json:"authUrl"`
	TokenURL     string `json:"tokenUrl"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Scope        string `json:"scope"`
	RedirectURL  string `json:"redirectUrl"` // must match what's registered; defaults to http://127.0.0.1:8089/callback
	ClientAuth   string `json:"clientAuth"`  // "basic" | "body" (default)
	UsePKCE      bool   `json:"usePkce"`
}

const defaultRedirectURL = "http://127.0.0.1:8089/callback"

type OAuth2Token struct {
	AccessToken  string `json:"accessToken"`
	TokenType    string `json:"tokenType"`
	ExpiresIn    int    `json:"expiresIn"`
	RefreshToken string `json:"refreshToken"`
	Raw          string `json:"raw"`
	Error        string `json:"error"`
}

// FetchOAuth2Token requests a token from an OAuth 2.0 token endpoint. Supports the grants that
// don't need a browser redirect (client_credentials, password, refresh_token).
func (s *AppService) FetchOAuth2Token(cfg OAuth2Config) OAuth2Token {
	form := url.Values{}
	switch cfg.GrantType {
	case "password":
		form.Set("grant_type", "password")
		form.Set("username", cfg.Username)
		form.Set("password", cfg.Password)
	case "refresh_token":
		form.Set("grant_type", "refresh_token")
		form.Set("refresh_token", cfg.RefreshToken)
	default:
		form.Set("grant_type", "client_credentials")
	}
	if cfg.Scope != "" {
		form.Set("scope", cfg.Scope)
	}
	return postTokenRequest(cfg.TokenURL, form, cfg.ClientAuth, cfg.ClientID, cfg.ClientSecret)
}

// postTokenRequest performs the form-encoded POST to a token endpoint and parses the response.
// Shared by every grant. clientAuth=="basic" sends credentials via the Authorization header,
// otherwise client_id/client_secret are added to the form body (if non-empty).
func postTokenRequest(tokenURL string, form url.Values, clientAuth, clientID, clientSecret string) OAuth2Token {
	if clientAuth != "basic" {
		if clientID != "" {
			form.Set("client_id", clientID)
		}
		if clientSecret != "" {
			form.Set("client_secret", clientSecret)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return OAuth2Token{Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if clientAuth == "basic" {
		req.SetBasicAuth(clientID, clientSecret)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return OAuth2Token{Error: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	raw := string(body)

	var parsed struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int    `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}
	_ = json.Unmarshal(body, &parsed)

	if resp.StatusCode >= 400 || parsed.AccessToken == "" {
		msg := parsed.ErrorDesc
		if msg == "" {
			msg = parsed.Error
		}
		if msg == "" {
			msg = strings.TrimSpace(raw)
			if msg == "" {
				msg = resp.Status
			}
		}
		return OAuth2Token{Raw: raw, Error: msg}
	}

	return OAuth2Token{
		AccessToken:  parsed.AccessToken,
		TokenType:    parsed.TokenType,
		ExpiresIn:    parsed.ExpiresIn,
		RefreshToken: parsed.RefreshToken,
		Raw:          raw,
	}
}

// AuthorizeOAuth2 runs the Authorization Code grant: it spins up a one-shot local callback server,
// opens the provider's consent page in the browser, waits for the redirect carrying the code, then
// exchanges that code for tokens. Only works on the desktop build (needs a real browser + loopback
// server). PKCE is added automatically when cfg.UsePKCE is set.
func (s *AppService) AuthorizeOAuth2(cfg OAuth2AuthCodeConfig) OAuth2Token {
	if cfg.AuthURL == "" || cfg.TokenURL == "" {
		return OAuth2Token{Error: "authorization URL and token URL are required"}
	}
	redirect := cfg.RedirectURL
	if redirect == "" {
		redirect = defaultRedirectURL
	}
	redirectURL, err := url.Parse(redirect)
	if err != nil {
		return OAuth2Token{Error: "invalid redirect URL: " + err.Error()}
	}

	listenAddr := redirectURL.Host
	if listenAddr == "" {
		return OAuth2Token{Error: "redirect URL has no host:port"}
	}
	if redirectURL.Port() == "" {
		listenAddr += ":80"
	}
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return OAuth2Token{Error: "cannot bind callback server on " + listenAddr + ": " + err.Error()}
	}
	defer listener.Close()

	state, err := randomString(24)
	if err != nil {
		return OAuth2Token{Error: err.Error()}
	}

	// Build the authorization URL.
	authValues := url.Values{}
	authValues.Set("response_type", "code")
	authValues.Set("client_id", cfg.ClientID)
	authValues.Set("redirect_uri", redirect)
	authValues.Set("state", state)
	if cfg.Scope != "" {
		authValues.Set("scope", cfg.Scope)
	}
	var verifier string
	if cfg.UsePKCE {
		verifier, err = randomString(48)
		if err != nil {
			return OAuth2Token{Error: err.Error()}
		}
		sum := sha256.Sum256([]byte(verifier))
		challenge := base64.RawURLEncoding.EncodeToString(sum[:])
		authValues.Set("code_challenge", challenge)
		authValues.Set("code_challenge_method", "S256")
	}
	sep := "?"
	if strings.Contains(cfg.AuthURL, "?") {
		sep = "&"
	}
	authURL := cfg.AuthURL + sep + authValues.Encode()

	// Wait for the redirect to hit the callback path.
	type callbackResult struct {
		code string
		err  string
	}
	resultCh := make(chan callbackResult, 1)
	server := &http.Server{}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != redirectURL.Path {
			http.NotFound(w, r)
			return
		}
		q := r.URL.Query()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if e := q.Get("error"); e != "" {
			msg := e
			if d := q.Get("error_description"); d != "" {
				msg += ": " + d
			}
			fmt.Fprint(w, callbackPage("Authorization failed", msg))
			resultCh <- callbackResult{err: msg}
			return
		}
		if q.Get("state") != state {
			fmt.Fprint(w, callbackPage("Authorization failed", "state mismatch (possible CSRF)"))
			resultCh <- callbackResult{err: "state mismatch"}
			return
		}
		code := q.Get("code")
		if code == "" {
			fmt.Fprint(w, callbackPage("Authorization failed", "no code in callback"))
			resultCh <- callbackResult{err: "no authorization code returned"}
			return
		}
		fmt.Fprint(w, callbackPage("Authorization complete", "You can close this tab and return to Yarc."))
		resultCh <- callbackResult{code: code}
	})
	go func() { _ = server.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	if app := application.Get(); app != nil {
		if err := app.Browser.OpenURL(authURL); err != nil {
			return OAuth2Token{Error: "could not open browser: " + err.Error()}
		}
	} else {
		return OAuth2Token{Error: "browser unavailable (desktop only)"}
	}

	select {
	case res := <-resultCh:
		if res.err != "" {
			return OAuth2Token{Error: res.err}
		}
		form := url.Values{}
		form.Set("grant_type", "authorization_code")
		form.Set("code", res.code)
		form.Set("redirect_uri", redirect)
		if verifier != "" {
			form.Set("code_verifier", verifier)
		}
		return postTokenRequest(cfg.TokenURL, form, cfg.ClientAuth, cfg.ClientID, cfg.ClientSecret)
	case <-time.After(3 * time.Minute):
		return OAuth2Token{Error: "timed out waiting for authorization (3m)"}
	}
}

// randomString returns a URL-safe random string with n bytes of entropy.
func randomString(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func callbackPage(title, message string) string {
	return fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><title>%s</title>`+
		`<style>body{font-family:system-ui,sans-serif;background:#14181f;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0}`+
		`.card{text-align:center;padding:2rem 3rem;border:1px solid #2a2f3a;border-radius:12px;background:#191d24}`+
		`h1{font-size:1.1rem;margin:0 0 .5rem}p{color:#94a3b8;margin:0}</style></head>`+
		`<body><div class="card"><h1>%s</h1><p>%s</p></div></body></html>`, title, title, message)
}
