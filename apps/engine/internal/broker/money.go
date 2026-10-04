package broker

import "math"

// Paise converts a broker's rupee float, rounding away float error (1234.549999 → 123455).
func Paise(rupees float64) int64 {
	return int64(math.Round(rupees * 100))
}

func Rupees(paise int64) float64 {
	return float64(paise) / 100
}
