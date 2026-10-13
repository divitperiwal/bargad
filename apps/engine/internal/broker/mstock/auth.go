package mstock

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/broker/totp"
)

var ist = time.FixedZone("IST", 5*3600+1800)

// Login exchanges the platform key and the member's TOTP for a session that lasts until midnight IST.
func (c *Client) Login(ctx context.Context, clientID string, creds broker.Credentials) (broker.Session, error) {
	if c.apiKey == "" {
		return broker.Session{}, errors.New("mstock: MSTOCK_API_KEY is not set")
	}
	code, err := totp.Code(creds.TOTPSecret, c.now())
	if err != nil {
		return broker.Session{}, fmt.Errorf("%w: %w", broker.ErrInvalidCredentials, err)
	}

	var out struct {
		AccessToken string `json:"access_token"`
	}
	err = c.do(ctx, broker.Session{}, http.MethodPost, "/session/verifytotp",
		url.Values{"api_key": {c.apiKey}, "totp": {code}}, &out)

	var rejected *broker.RejectedError
	if errors.As(err, &rejected) || errors.Is(err, broker.ErrSessionExpired) {
		return broker.Session{}, broker.ErrInvalidCredentials
	}
	if err != nil {
		return broker.Session{}, err
	}
	if out.AccessToken == "" {
		return broker.Session{}, errors.New("mstock login: empty access token")
	}

	now := c.now().In(ist)
	midnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, ist)
	return broker.Session{ClientID: clientID, Token: out.AccessToken, ExpiresAt: midnight}, nil
}
