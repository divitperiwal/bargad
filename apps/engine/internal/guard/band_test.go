package guard

import (
	"testing"

	"bargad/engine/internal/broker"
)

func TestLimitPrice(t *testing.T) {
	for _, tc := range []struct {
		name string
		side broker.Side
		ref  int64
		band int32
		tick int32
		want int64
	}{
		{"buy on tick", broker.Buy, 10000, 100, 5, 10100},
		{"buy rounds down", broker.Buy, 12345, 100, 5, 12465},
		{"sell rounds up", broker.Sell, 12345, 100, 5, 12225},
		{"sell 1 paisa tick", broker.Sell, 27000, 100, 1, 26730},
		{"wide band", broker.Buy, 130000, 1000, 10, 143000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := LimitPrice(tc.side, tc.ref, tc.band, tc.tick)
			if got != tc.want {
				t.Errorf("LimitPrice = %d, want %d", got, tc.want)
			}
			if got%int64(tc.tick) != 0 {
				t.Errorf("%d is not a multiple of tick %d", got, tc.tick)
			}
			if !InBand(got, tc.ref, tc.band) {
				t.Errorf("%d is outside %d bps of %d", got, tc.band, tc.ref)
			}
		})
	}
}

func TestInBand(t *testing.T) {
	if !InBand(10100, 10000, 100) || !InBand(9900, 10000, 100) {
		t.Error("edges of the band should be inside")
	}
	if InBand(10101, 10000, 100) || InBand(9899, 10000, 100) {
		t.Error("just past the band should be outside")
	}
}
