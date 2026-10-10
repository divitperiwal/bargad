package dhan

import (
	"encoding/base64"

	"github.com/google/uuid"
)

const maxCorrelationLen = 30

// correlationID fits our order UUID (36 chars) into Dhan's 30-character
// correlationId, [a-zA-Z0-9 _-]: base64url of its 16 bytes is 22 chars.
func correlationID(tag string) string {
	id, err := uuid.Parse(tag)
	if err != nil {
		if len(tag) > maxCorrelationLen {
			return tag[:maxCorrelationLen]
		}
		return tag
	}
	return base64.RawURLEncoding.EncodeToString(id[:])
}
