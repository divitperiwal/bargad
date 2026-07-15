import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { logger } from '#config/logger.config';
import { ApiError, defaultCode } from '#utils/http/error.util';

type KnownError = { status: ContentfulStatusCode; message: string };

// The schema enforces most rules, so hitting a constraint is a client error, not a 500. Keyed by SQLSTATE.
const postgresErrors: Record<string, KnownError> = {
  '23505': { status: 409, message: 'That already exists' },
  '23503': { status: 409, message: 'That conflicts with related data' },
  '23514': { status: 400, message: 'That breaks a rule on this data' },
  '23502': { status: 400, message: 'A required value is missing' },
  '22P02': { status: 400, message: 'A value has the wrong format' },
};

const postgresCode = (err: Error) => (err.cause as { errno?: string } | undefined)?.errno;

function postgresError(err: Error): KnownError | undefined {
  const code = postgresCode(err);
  return code ? postgresErrors[code] : undefined;
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) {
    return c.json({ success: false, error: err.message, code: err.code, issues: err.issues }, err.status);
  }

  if (err instanceof HTTPException) {
    return c.json({ success: false, error: err.message, code: defaultCode(err.status) }, err.status);
  }

  const known = postgresError(err);
  if (known) {
    return c.json({ success: false, error: known.message, code: defaultCode(known.status) }, known.status);
  }

  logger.error({ err }, 'unhandled error');
  return c.json({ success: false, error: 'Something went wrong', code: 'internal' }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json({ success: false, error: 'Not found', code: 'not_found' }, 404);
