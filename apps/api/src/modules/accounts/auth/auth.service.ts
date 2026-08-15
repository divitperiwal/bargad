import type { LoginInput, SignupInput } from '@bargad/shared';
import { type Db, withTransaction } from '#config/database.config';
import { SESSION_MAX_AGE_SECONDS } from '#constant';
import { ApiError } from '#utils/http/error.util';
import { hashToken } from '#utils/security/crypto.util';
import { generateToken } from '#utils/security/token.util';
import { dummyHash, type SignedIn } from './auth.helper';
import { AuthRepository } from './auth.repository';

export const AuthService = {
  // Stores only the token's hash; the raw token is returned once, to the client.
  createSession: async (userId: string, client: 'web' | 'app', conn: Db) => {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    await AuthRepository.insertSession(
      { tokenHash: hashToken(token), userId, client, expiresAt: expiresAt.toISOString() },
      conn,
    );
    return { token, expiresAt };
  },

  signup: async (input: SignupInput): Promise<SignedIn> => {
    const passwordHash = await Bun.password.hash(input.password, 'argon2id');
    return withTransaction(async (tx) => {
      const user = await AuthRepository.insertUser(
        {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          mobile: input.mobile,
          dateOfBirth: input.dateOfBirth,
        },
        tx,
      );
      if (!user) throw new ApiError(409, 'An account with this email already exists', { code: 'email_taken' });
      return { user, ...(await AuthService.createSession(user.id, input.client, tx)) };
    });
  },

  login: async (input: LoginInput): Promise<SignedIn> => {
    const found = await AuthRepository.findLoginByEmail(input.email);
    const matches = await Bun.password.verify(input.password, found?.passwordHash ?? dummyHash);
    if (!found || !matches) {
      throw new ApiError(401, 'Wrong email or password', { code: 'invalid_credentials' });
    }
    const { passwordHash: _passwordHash, ...user } = found;
    return withTransaction(async (tx) => ({ user, ...(await AuthService.createSession(user.id, input.client, tx)) }));
  },

  logout: (sessionHash: Uint8Array) => AuthRepository.revokeSession(sessionHash),
};
