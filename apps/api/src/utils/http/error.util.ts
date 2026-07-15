import type { ContentfulStatusCode } from 'hono/utils/http-status';

const defaultCodes: Partial<Record<ContentfulStatusCode, string>> = {
  400: 'invalid_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
  503: 'unavailable',
};

export function defaultCode(status: ContentfulStatusCode): string {
  return defaultCodes[status] ?? 'internal';
}

type ApiErrorOptions = { code?: string; issues?: Record<string, string[] | undefined> };

// Throw from any layer for an expected failure; errorHandler turns it into the error response.
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly issues?: Record<string, string[] | undefined>;

  constructor(status: ContentfulStatusCode, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.status = status;
    this.code = options.code ?? defaultCode(status);
    this.issues = options.issues;
  }
}
