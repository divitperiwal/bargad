// NSE trades on IST weekdays that are not holidays, until 15:30 IST (10:00 UTC; IST has no daylight saving).
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const marketCloseOf = (day: string): Date => new Date(`${day}T10:00:00.000Z`);

// The day an order placed now would trade: today if the market is still to close, otherwise the next trading day.
export function tradingDayFor(now: Date, holidays: ReadonlySet<string>): string {
  let day = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  if (now >= marketCloseOf(day)) day = nextDay(day);
  while (!isTradingDay(day, holidays)) day = nextDay(day);
  return day;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

const isTradingDay = (day: string, holidays: ReadonlySet<string>) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(day);
};
