// Package mstock is the mStock (Type A) adapter, written from mStock's public
// API docs. It can't be exercised against the live API until the platform key
// is issued: verify every endpoint before real money goes through it.
package mstock

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"bargad/engine/internal/broker"
)

var _ broker.Broker = (*Client)(nil)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
	now     func() time.Time
}

func New(baseURL, apiKey string, now func() time.Time) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http:    &http.Client{Timeout: 10 * time.Second},
		now:     now,
	}
}

func (c *Client) Name() string { return "mstock" }

type envelope struct {
	Status    string          `json:"status"`
	Message   string          `json:"message"`
	ErrorType string          `json:"error_type"`
	Data      json.RawMessage `json:"data"`
}

// do sends one request: form is the body for POST, the query string otherwise.
func (c *Client) do(ctx context.Context, s broker.Session, method, path string, form url.Values, out any) error {
	u := c.baseURL + path
	var body io.Reader
	if method == http.MethodPost {
		body = strings.NewReader(form.Encode())
	} else if len(form) > 0 {
		u += "?" + form.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return err
	}
	req.Header.Set("X-Mirae-Version", "1")
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if s.Token != "" {
		req.Header.Set("Authorization", "token "+c.apiKey+":"+s.Token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("mstock %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }() // the body is read in full below; a close error changes nothing
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("mstock read body: %w", err)
	}

	var env envelope
	_ = json.Unmarshal(raw, &env) // a non-JSON body is handled by the status checks below

	switch {
	case env.ErrorType == "APIKeyException": // platform key invalid or subscription expired
		return fmt.Errorf("mstock %s %s: %s", method, path, env.Message)
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden,
		env.ErrorType == "TokenException":
		return broker.ErrSessionExpired
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return fmt.Errorf("mstock %s %s: %s", method, path, resp.Status)
	case resp.StatusCode >= 400 || env.Status == "error":
		reason := env.Message
		if reason == "" {
			reason = resp.Status
		}
		return &broker.RejectedError{Reason: reason}
	}

	if out == nil || len(env.Data) == 0 {
		return nil
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		return fmt.Errorf("mstock decode %s: %w", path, err)
	}
	return nil
}
