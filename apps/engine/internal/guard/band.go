// Package guard holds the checks that stand between a job and a broker:
// the price band, kill switches, and per-broker pacing and circuit breakers.
package guard

import "bargad/engine/internal/broker"

// LimitPrice is ref ± band (ADR 4), rounded to the tick toward ref so it stays in the band.
func LimitPrice(side broker.Side, ref int64, bandBps, tickPaise int32) int64 {
	band, tick := int64(bandBps), int64(max(tickPaise, 1))
	if side == broker.Buy {
		raw := ref * (10000 + band) / 10000
		return raw - raw%tick
	}
	raw := ref * (10000 - band) / 10000
	if rem := raw % tick; rem != 0 {
		raw += tick - rem
	}
	return raw
}

// InBand reports whether price is within bandBps of ref, the same test as orders_within_band.
func InBand(price, ref int64, bandBps int32) bool {
	band := int64(bandBps)
	return price*10000 >= ref*(10000-band) && price*10000 <= ref*(10000+band)
}
