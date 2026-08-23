import { env } from './env.config';

export const webauthnConfig = {
  rpId: env.RP_ID,
  rpName: env.RP_NAME,
  origins: (env.WEBAUTHN_ORIGINS ?? env.WEB_ORIGIN).split(',').map((origin) => origin.trim()),
};
