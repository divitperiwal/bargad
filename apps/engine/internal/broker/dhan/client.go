// Package dhan is the Dhan v2 adapter, written from Dhan's public API docs.
// It can't be exercised against the live API until the partner ID is issued:
// verify every endpoint before real money goes through it.
package dhan

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"bargad/engine/internal/broker"
)

var _ broker.Broker = (*Client)(nil)

type Client struct {
	baseURL string
	authURL string
	http    *http.Client
	now     func() time.Time
}

func New(baseURL, authURL string, now func() time.Time) *Client {
	return &Client{
		baseURL: baseURL,
		authURL: authURL,
		http:    &http.Client{Timeout: 10 * time.Second},
		now:     now,
	}
}

func (c *Client) Name() string { return "dhan" }

// Codes from Dhan's annexure. Which HTTP status carries them isn't documented.
var (
	sessionCodes = map[string]bool{"DH-901": true, "807": true, "808": true} // invalid or expired token
	rateCodes    = map[string]bool{"DH-904": true, "805": true}              // rate limited: retry, not a rejection
)

type apiError struct {
	ErrorCode    string          `json:"errorCode"`
	ErrorMessage string          `json:"errorMessage"`
	Data         json.RawMessage `json:"data"` // Data APIs put {"807": "message"} here
}

func (e apiError) has(codes map[string]bool) bool {
	if codes[e.ErrorCode] {
		return true
	}
	var data map[string]any
	if json.Unmarshal(e.Data, &data) == nil {
		for code := range data {
			if codes[code] {
				return true
			}
		}
	}
	return false
}

func (e apiError) message(fallback string) string {
	if e.ErrorMessage != "" {
		return e.ErrorCode + ": " + e.ErrorMessage
	}
	return fallback
}

// do sends one request. 401/403 is an expired session, other 4xx a definite
// refusal, and anything else (5xx, network) stays an ordinary error: unknown.
func (c *Client) do(ctx context.Context, s broker.Session, method, url string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	if s.Token != "" {
		req.Header.Set("access-token", s.Token)
		req.Header.Set("client-id", s.ClientID)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("dhan %s %s: %w", method, url, err)
	}
	defer func() { _ = resp.Body.Close() }() // the body is read in full below; a close error changes nothing
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("dhan read body: %w", err)
	}

	if resp.StatusCode >= 400 {
		var apiErr apiError
		_ = json.Unmarshal(raw, &apiErr) // best effort; the status alone still classifies it
		switch {
		case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden || apiErr.has(sessionCodes):
			return broker.ErrSessionExpired
		case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 || apiErr.has(rateCodes):
			return fmt.Errorf("dhan %s %s: %s", method, url, apiErr.message(resp.Status))
		case resp.StatusCode == http.StatusNotFound:
			return broker.ErrOrderNotFound
		default:
			return &broker.RejectedError{Reason: apiErr.message(resp.Status)}
		}
	}

	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("dhan decode %s: %w", url, err)
	}
	return nil
}
