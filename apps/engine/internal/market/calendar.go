// Package market knows when NSE trades: weekdays 09:15–15:30 IST, minus holidays.
package market

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// IST has no daylight saving, so a fixed zone needs no tzdata.
var IST = time.FixedZone("IST", 5*3600+30*60)

const (
	openMinute  = 9*60 + 15
	closeMinute = 15*60 + 30
	dayLayout   = "2006-01-02"
)

type HolidaySource interface {
	ListHolidays(ctx context.Context, fromDay time.Time) ([]time.Time, error)
}

type Calendar struct {
	src      HolidaySource
	now      func() time.Time
	log      *slog.Logger
	mu       sync.RWMutex
	holidays map[string]struct{}
}

func NewCalendar(src HolidaySource, now func() time.Time, log *slog.Logger) *Calendar {
	return &Calendar{src: src, now: now, log: log, holidays: map[string]struct{}{}}
}

// Refresh reloads holidays from yesterday onwards.
func (c *Calendar) Refresh(ctx context.Context) error {
	days, err := c.src.ListHolidays(ctx, Day(c.now().AddDate(0, 0, -1)))
	if err != nil {
		return err
	}
	set := make(map[string]struct{}, len(days))
	for _, d := range days {
		set[d.Format(dayLayout)] = struct{}{} // DATE columns arrive as UTC midnight
	}
	c.mu.Lock()
	c.holidays = set
	c.mu.Unlock()
	return nil
}

func (c *Calendar) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := c.Refresh(ctx); err != nil && ctx.Err() == nil {
				c.log.Warn("refresh trading holidays", "err", err)
			}
		}
	}
}

// Day is t's IST calendar date as UTC midnight, the shape a DATE column holds.
func Day(t time.Time) time.Time {
	y, m, d := t.In(IST).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func (c *Calendar) IsTradingDay(t time.Time) bool {
	local := t.In(IST)
	if wd := local.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, holiday := c.holidays[local.Format(dayLayout)]
	return !holiday
}

func (c *Calendar) IsOpen(t time.Time) bool {
	local := t.In(IST)
	minute := local.Hour()*60 + local.Minute()
	return minute >= openMinute && minute < closeMinute && c.IsTradingDay(t)
}

// NextOpen is the next 09:15 IST on a trading day that's after t (t itself if open).
func (c *Calendar) NextOpen(t time.Time) time.Time {
	if c.IsOpen(t) {
		return t
	}
	local := t.In(IST)
	for d := 0; d < 30; d++ {
		day := local.AddDate(0, 0, d)
		open := time.Date(day.Year(), day.Month(), day.Day(), 9, 15, 0, 0, IST)
		if open.After(t) && c.IsTradingDay(open) {
			return open
		}
	}
	return local.Add(24 * time.Hour) // unreachable unless the holiday table is absurd
}

// Close is 15:30 IST on t's day.
func Close(t time.Time) time.Time {
	local := t.In(IST)
	return time.Date(local.Year(), local.Month(), local.Day(), 15, 30, 0, 0, IST)
}
