package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
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
	if cfg.ClientAuth != "basic" {
		if cfg.ClientID != "" {
			form.Set("client_id", cfg.ClientID)
		}
		if cfg.ClientSecret != "" {
			form.Set("client_secret", cfg.ClientSecret)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return OAuth2Token{Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if cfg.ClientAuth == "basic" {
		req.SetBasicAuth(cfg.ClientID, cfg.ClientSecret)
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
