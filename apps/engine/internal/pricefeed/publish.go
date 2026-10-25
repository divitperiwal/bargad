package pricefeed

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync/atomic"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

const (
	priceTTL      = time.Hour
	pricesChannel = "prices"
	warnEvery     = time.Minute
)

// RedisPublisher writes price:{instrumentId} = {paise, at} and publishes each batch on "prices".
type RedisPublisher struct {
	rdb      *goredis.Client
	log      *slog.Logger
	lastWarn atomic.Int64 // unix seconds
}

func NewRedisPublisher(rdb *goredis.Client, log *slog.Logger) *RedisPublisher {
	return &RedisPublisher{rdb: rdb, log: log.With("component", "pricefeed")}
}

func (p *RedisPublisher) Publish(ctx context.Context, ticks []Tick) error {
	if len(ticks) == 0 {
		return nil
	}
	batch, err := json.Marshal(ticks)
	if err != nil {
		return err
	}

	pipe := p.rdb.Pipeline()
	for _, t := range ticks {
		raw, err := json.Marshal(struct {
			Paise int64     `json:"paise"`
			At    time.Time `json:"at"`
		}{t.Paise, t.At})
		if err != nil {
			return err
		}
		pipe.Set(ctx, "price:"+t.InstrumentID.String(), raw, priceTTL)
	}
	pipe.Publish(ctx, pricesChannel, batch)

	if _, err := pipe.Exec(ctx); err != nil {
		p.warn(err)
		return err
	}
	return nil
}

// warn logs at most once a minute, so a stopped Redis doesn't flood the logs.
func (p *RedisPublisher) warn(err error) {
	now := time.Now().Unix()
	last := p.lastWarn.Load()
	if now-last < int64(warnEvery.Seconds()) || !p.lastWarn.CompareAndSwap(last, now) {
		return
	}
	p.log.Warn("redis unavailable; prices still reach the executor", "err", err)
}
