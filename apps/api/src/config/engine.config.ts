import { env } from './env.config';

export const engineConfig = {
  publicKey: env.ENGINE_PUBLIC_KEY,
  keyVersion: env.ENGINE_KEY_VERSION,
};
