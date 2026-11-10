import { killSwitches } from '#database/schema';
import { toIso } from '#utils/time/time.util';

export const switchColumns = {
  scope: killSwitches.scope,
  scopeKey: killSwitches.scopeKey,
  engaged: killSwitches.engaged,
  reason: killSwitches.reason,
  changedBy: killSwitches.changedBy,
  changedAt: killSwitches.changedAt,
};

export const toKillSwitch = (row: { changedAt: string } & Record<string, unknown>) => ({
  ...row,
  changedAt: toIso(row.changedAt),
});
