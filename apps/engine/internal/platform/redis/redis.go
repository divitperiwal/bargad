// Package redis opens the optional Valkey client. Nothing on the money path may use it (ADR 3).
package redis

import (
	"fmt"

	goredis "github.com/redis/go-redis/v9"
)

// Connect returns nil, nil when url is empty: Redis is off and the engine still trades.
func Connect(url string) (*goredis.Client, error) {
	if url == "" {
		return nil, nil
	}
	opts, err := goredis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	return goredis.NewClient(opts), nil
}
