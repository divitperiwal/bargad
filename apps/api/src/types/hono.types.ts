export type User = { id: string; email: string; displayName: string; isAdmin: boolean };

// Variables set by requireUser; use on routers and controllers behind it.
export type AuthEnv = { Variables: { user: User; sessionHash: Uint8Array } };
