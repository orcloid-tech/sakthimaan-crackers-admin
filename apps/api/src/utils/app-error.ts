import type { ErrorCode } from '@sakthimaan/shared';

/**
 * An expected, client-facing error. Anything else thrown is treated as a bug:
 * logged with its stack and returned as a generic 500.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    /** Extra response headers, e.g. Retry-After. */
    public readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (code: ErrorCode = 'UNAUTHORIZED', message = 'Authentication required') =>
  new AppError(401, code, message);

export const forbidden = (message = 'You do not have permission to do this', details?: unknown) =>
  new AppError(403, 'FORBIDDEN', message, details);

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);

export const conflict = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export const serviceUnavailable = (message = 'Service temporarily unavailable') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);
