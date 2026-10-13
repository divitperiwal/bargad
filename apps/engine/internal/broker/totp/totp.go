// Package totp computes RFC 6238 codes (SHA-1, 30 s, 6 digits) for stored-credential logins.
package totp

import (
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // RFC 6238 default; brokers' authenticators use it
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

const step = 30

// Code returns the 6-digit code for secret (base32, as in an authenticator QR) at t.
func Code(secret string, t time.Time) (string, error) {
	clean := strings.ToUpper(strings.ReplaceAll(secret, " ", ""))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.TrimRight(clean, "="))
	if err != nil {
		return "", fmt.Errorf("totp secret: %w", err)
	}

	counter := uint64(t.Unix()) / step //nolint:gosec // time is after 1970
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	code := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", code%1_000_000), nil
}
