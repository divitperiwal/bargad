import { hostname } from 'node:os';
import { tryGetContext } from 'hono/context-storage';
import type {} from 'hono/request-id';
import pino, { type DestinationStream, type Level } from 'pino';
import { env } from './env.config';

const scrub = (text: string | undefined) => text?.replace(/params:[\s\S]*?(?=\n\s+at |$)/, 'params: [redacted]');

type SerializedError = { type: string; message?: string; stack?: string; code?: string; cause?: SerializedError };

export function serializeError(err: unknown, depth = 0): SerializedError {
  if (!(err instanceof Error)) return { type: typeof err, message: scrub(String(err)) };
  const { errno, code } = err as { errno?: unknown; code?: unknown };
  return {
    type: err.name,
    message: scrub(err.message),
    stack: scrub(err.stack),
    code: typeof errno === 'string' ? errno : typeof code === 'string' ? code : undefined,
    cause: err.cause !== undefined && depth < 3 ? serializeError(err.cause, depth + 1) : undefined,
  };
}

const SECRET_KEYS = ['password', 'newPassword', 'token', 'accessToken', 'secret', 'authorization', 'cookie'];

export function createLogger(level: Level | 'silent' = env.LOG_LEVEL, destination?: DestinationStream) {
  return pino(
    {
      level,
      base: { service: 'api', env: env.NODE_ENV, hostname: hostname(), pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: serializeError },
      redact: { paths: SECRET_KEYS.flatMap((key) => [key, `*.${key}`]), censor: '[redacted]' },
      mixin: () => {
        const requestId = tryGetContext()?.get('requestId');
        return requestId ? { requestId } : {};
      },
    },
    destination,
  );
}

export const logger = createLogger();
