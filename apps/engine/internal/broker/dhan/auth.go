package dhan

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

type tokenResponse struct {
	AccessToken string `json:"accessToken"`
	ExpiryTime  string `json:"expiryTime"`
}

// Login uses the stored PIN and TOTP secret (Dhan's generateAccessToken).
func (c *Client) Login(ctx context.Context, clientID string, creds broker.Credentials) (broker.Session, error) {
	code, err := totp.Code(creds.TOTPSecret, c.now())
	if err != nil {
		return broker.Session{}, fmt.Errorf("%w: %w", broker.ErrInvalidCredentials, err)
	}

	q := url.Values{"dhanClientId": {clientID}, "pin": {creds.PIN}, "totp": {code}}
	var out tokenResponse
	err = c.do(ctx, broker.Session{}, http.MethodPost, c.authURL+"/app/generateAccessToken?"+q.Encode(), nil, &out)

	var rejected *broker.RejectedError
	if errors.As(err, &rejected) || errors.Is(err, broker.ErrSessionExpired) {
		return broker.Session{}, broker.ErrInvalidCredentials
	}
	if err != nil {
		return broker.Session{}, err
	}
	if out.AccessToken == "" {
		return broker.Session{}, errors.New("dhan login: empty access token")
	}

	expires, err := time.ParseInLocation("2006-01-02T15:04:05.999", out.ExpiryTime, ist)
	if err != nil {
		expires = c.now().Add(24 * time.Hour)
	}
	return broker.Session{ClientID: clientID, Token: out.AccessToken, ExpiresAt: expires}, nil
}
