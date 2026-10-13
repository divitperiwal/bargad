package broker

import (
	"math"
	"strconv"
	"strings"
)

// Number decodes a JSON number or a numeric string; both brokers send both.
// Empty strings and null decode as 0.
type Number float64

func (n *Number) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*n = 0
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return err
	}
	*n = Number(f)
	return nil
}

func (n Number) Float() float64 { return float64(n) }
func (n Number) Int() int64     { return int64(math.Round(float64(n))) }
