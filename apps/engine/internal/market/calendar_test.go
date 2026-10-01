package market

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

type holidayList []time.Time

func (h holidayList) ListHolidays(context.Context, time.Time) ([]time.Time, error) { return h, nil }

func ist(y int, m time.Month, d, hh, mm int) time.Time {
	return time.Date(y, m, d, hh, mm, 0, 0, IST)
}

func newCalendar(t *testing.T, holidays ...time.Time) *Calendar {
	t.Helper()
	c := NewCalendar(holidayList(holidays), time.Now, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := c.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestIsOpen(t *testing.T) {
	// 2026-11-16 is a Monday.
	c := newCalendar(t, time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC))
	for _, tc := range []struct {
		name string
		at   time.Time
		want bool
	}{
		{"monday morning", ist(2026, 11, 16, 10, 0), true},
		{"before open", ist(2026, 11, 16, 9, 14), false},
		{"at open", ist(2026, 11, 16, 9, 15), true},
		{"at close", ist(2026, 11, 16, 15, 30), false},
		{"saturday", ist(2026, 11, 21, 10, 0), false},
		{"holiday", ist(2026, 11, 18, 10, 0), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := c.IsOpen(tc.at); got != tc.want {
				t.Errorf("IsOpen(%s) = %v, want %v", tc.at, got, tc.want)
			}
		})
	}
}

func TestNextOpenSkipsWeekendAndHoliday(t *testing.T) {
	c := newCalendar(t, time.Date(2026, 11, 23, 0, 0, 0, 0, time.UTC)) // Monday holiday
	got := c.NextOpen(ist(2026, 11, 20, 18, 0))                        // Friday evening
	want := ist(2026, 11, 24, 9, 15)                                   // Tuesday open
	if !got.Equal(want) {
		t.Errorf("NextOpen = %s, want %s", got, want)
	}
}

func TestDayUsesISTDate(t *testing.T) {
	// 20:00 UTC on the 16th is 01:30 IST on the 17th.
	got := Day(time.Date(2026, 11, 16, 20, 0, 0, 0, time.UTC))
	if want := time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC); !got.Equal(want) {
		t.Errorf("Day = %s, want %s", got, want)
	}
}
