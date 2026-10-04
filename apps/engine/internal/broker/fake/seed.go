package fake

// Mirrors db/seed.sql, so syncing the demo family from the fake broker keeps its holdings.

type seedInstrument struct {
	symbol string
	isin   string
	paise  int64
}

var seedInstruments = []seedInstrument{
	{"NIFTYBEES", "INF204KB14I2", 27000},
	{"GOLDBEES", "INF204KB17I5", 7600},
	{"RELIANCE", "INE002A01018", 130000},
	{"TCS", "INE467B01029", 345000},
	{"HDFCBANK", "INE040A01034", 97000},
	{"INFY", "INE009A01021", 152000},
}

type seedHolding struct {
	symbol       string
	quantity     int64
	avgCostPaise int64
}

var seedHoldings = map[string][]seedHolding{
	"FAKE-ROHAN": {{"NIFTYBEES", 400, 26150}, {"RELIANCE", 25, 128040}, {"TCS", 10, 341210}},
	"FAKE-PRIYA": {{"GOLDBEES", 300, 7420}, {"HDFCBANK", 40, 95580}},
	"FAKE-ANIL":  {{"INFY", 15, 151030}},
}
