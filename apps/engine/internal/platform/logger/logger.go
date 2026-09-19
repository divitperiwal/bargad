// Package logger builds the engine's JSON logger.
package logger

import (
	"io"
	"log/slog"
)

// New returns a JSON logger. level uses the API's names (fatal … trace, silent) so one LOG_LEVEL serves both.
func New(w io.Writer, level string) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: parseLevel(level)}))
}

func parseLevel(level string) slog.Level {
	switch level {
	case "debug", "trace":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error", "fatal":
		return slog.LevelError
	case "silent":
		return slog.LevelError + 100
	default:
		return slog.LevelInfo
	}
}
