import { brokerAccounts } from '#database/schema';
import { toIsoOrNull } from '#utils/time/time.util';

export const accountColumns = {
  id: brokerAccounts.id,
  userId: brokerAccounts.userId,
  broker: brokerAccounts.broker,
  brokerClientId: brokerAccounts.brokerClientId,
  label: brokerAccounts.label,
  loginMethod: brokerAccounts.loginMethod,
  hidden: brokerAccounts.hidden,
  status: brokerAccounts.status,
  holdingsSyncedAt: brokerAccounts.holdingsSyncedAt,
};

export type AccountRow = {
  id: string;
  userId: string;
  broker: string;
  brokerClientId: string;
  label: string;
  loginMethod: string;
  hidden: boolean;
  status: string;
  holdingsSyncedAt: string | null;
};

export type BrokerAccount = ReturnType<typeof toAccount>;

// The API role cannot read credentials back, so login_method says whether any are stored.
export const toAccount = ({ userId, holdingsSyncedAt, ...row }: AccountRow) => ({
  ...row,
  holdingsSyncedAt: toIsoOrNull(holdingsSyncedAt),
  hasStoredCredentials: row.loginMethod === 'stored_credentials',
  ownerUserId: userId,
});
