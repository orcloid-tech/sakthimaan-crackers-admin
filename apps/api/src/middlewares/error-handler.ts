import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { errors as joseErrors } from 'jose';
import type { ApiFailure, ValidationIssue } from '@sakthimaan/shared';
import { AppError } from '../utils/app-error.js';
import { requestIdOf } from './request-context.js';
import { multerToAppError } from './upload.js';

interface MongoServerErrorLike {
  name: string;
  code?: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKey(err: unknown): err is MongoServerErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as MongoServerErrorLike).code === 11000 &&
    ['MongoServerError', 'MongoBulkWriteError'].includes((err as MongoServerErrorLike).name)
  );
}

/** body-parser errors carry an HTTP status and a `type`. */
function bodyParserError(err: unknown): { status: number; type: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { status?: unknown; type?: unknown };
  return typeof e.status === 'number' && typeof e.type === 'string'
    ? { status: e.status, type: e.type }
    : null;
}

/** Maps known error types to AppError; returns null for unexpected errors. */
export function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  if (err instanceof mongoose.Error.ValidationError) {
    const details: ValidationIssue[] = Object.values(err.errors).map((e) => ({
      location: 'body',
      path: e.path,
      message: e.message,
      code: e.kind,
    }));
    return new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', details);
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(400, 'INVALID_ID', `Invalid value for ${err.path}`);
  }
  if (err instanceof mongoose.Error.VersionError) {
    return new AppError(
      409,
      'VERSION_CONFLICT',
      'This record was changed by someone else. Reload and try again.',
    );
  }
  if (isDuplicateKey(err)) {
    // Field names only: never echo the conflicting values back.
    return new AppError(409, 'DUPLICATE', 'A record with the same value already exists', {
      fields: Object.keys(err.keyValue ?? {}),
    });
  }
  if (err instanceof joseErrors.JWTExpired) {
    return new AppError(401, 'TOKEN_EXPIRED', 'Session expired');
  }
  if (err instanceof joseErrors.JOSEError) {
    return new AppError(401, 'TOKEN_INVALID', 'Invalid token');
  }

  const upload = multerToAppError(err);
  if (upload) return upload;

  const bp = bodyParserError(err);
  if (bp?.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (bp?.type === 'entity.parse.failed')
    return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (bp && bp.status >= 400 && bp.status < 500)
    return new AppError(bp.status, 'VALIDATION_ERROR', 'Bad request');

  return null;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

/**
 * Central error handler: every error leaves the API in the same envelope.
 * Expected errors are logged at warn/info; unexpected ones at error with stack, and the
 * client gets a generic message plus the request id to quote to support.
 */
export function errorHandler(opts: { exposeInternalErrors: boolean }): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appError = toAppError(err);
    const log = req.log;

    let status: number;
    let body: ApiFailure;
    if (appError) {
      status = appError.status;
      body = {
        success: false,
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details === undefined ? {} : { details: appError.details }),
        },
      };
      for (const [k, v] of Object.entries(appError.headers ?? {})) res.setHeader(k, v);
      log?.[status >= 500 ? 'error' : 'warn']({ code: appError.code, status }, appError.message);
    } else {
      status = 500;
      log?.error({ err }, 'Unhandled error');
      body = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: opts.exposeInternalErrors && err instanceof Error ? err.message : 'Something went wrong',
          details: { requestId: requestIdOf(req) },
        },
      };
    }

    if (res.headersSent) return; // response already streaming; nothing safe to send
    res.status(status).json(body);
  };
}
