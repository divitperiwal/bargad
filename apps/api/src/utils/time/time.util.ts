// Postgres hands timestamps back as "2026-11-15 00:41:11.921+00"; the API speaks ISO.
export const toIso = (value: string): string => new Date(value).toISOString();

export const toIsoOrNull = (value: string | null): string | null => (value === null ? null : toIso(value));
