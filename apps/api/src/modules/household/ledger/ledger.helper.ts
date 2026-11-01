import { ApiError } from '#utils/http/error.util';
import type { LedgerEntry } from './ledger.query';

export const notFound = () => new ApiError(404, 'Entry not found');

// Back to the shape the create schema takes: no nulls, no ids or timestamps.
export const toInput = (entry: LedgerEntry) => ({
  kind: entry.kind,
  type: entry.type,
  name: entry.name,
  valuePaise: entry.valuePaise,
  asOf: entry.asOf,
  hidden: entry.hidden,
  ...(entry.emiPaise === null ? {} : { emiPaise: entry.emiPaise }),
  ...(entry.interestRateBps === null ? {} : { interestRateBps: entry.interestRateBps }),
});
