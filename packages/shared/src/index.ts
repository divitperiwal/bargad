export * from './schemas/admin';
export * from './schemas/auth';
export * from './schemas/basket';
export * from './schemas/broker-account';
export * from './schemas/common';
export * from './schemas/family';
export * from './schemas/grant';
export * from './schemas/ledger';
export * from './schemas/passkey';
export * from './schemas/user';

// Body of every API error. Success bodies are { success: true, data }, typed through hc<AppType>.
export type ApiErrorBody = {
  success: false;
  error: string;
  code: string;
  issues?: Record<string, string[] | undefined>;
};
