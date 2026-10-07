package totp

import (
	"encoding/base32"
	"testing"
	"time"
)

// RFC 6238 appendix B, SHA-1, last 6 digits.
func TestCodeMatchesRFC6238(t *testing.T) {
	secret := base32.StdEncoding.EncodeToString([]byte("12345678901234567890"))
	for _, tc := range []struct {
		unix int64
		want string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1234567890, "005924"},
		{2000000000, "279037"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			got, err := Code(secret, time.Unix(tc.unix, 0))
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Errorf("Code at %d = %s, want %s", tc.unix, got, tc.want)
			}
		})
	}
}
