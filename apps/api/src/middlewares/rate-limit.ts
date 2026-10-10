import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/app-error.js';

/**
 * Rate limiters (in-memory store; no Redis by decision). Limits are per API instance,
 * so with N instances the effective limit is N×. Swap in a shared store if the API is
 * ever scaled horizontally.
 */
function limiter(opts: {
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
  message: string;
}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
    handler: (_req, _res, next, options) => {
      const retryAfter = String(Math.ceil(options.windowMs / 1000));
      next(new AppError(429, 'RATE_LIMITED', opts.message, undefined, { 'Retry-After': retryAfter }));
    },
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

/** Whole admin API, per IP. Generous: during Diwali several staff share one office IP. */
export const adminApiLimiter = (perMinute: number) =>
  limiter({ windowMs: 60_000, limit: perMinute, message: 'Too many requests, slow down' });

/**
 * Credential endpoints (login, 2FA, forgot/reset password), per IP + submitted email,
 * so one attacker can't lock out every account and one office IP doesn't block colleagues.
 */
export const authLimiter = (per15Min: number) =>
  limiter({
    windowMs: 15 * 60_000,
    limit: per15Min,
    message: 'Too many attempts. Try again in a few minutes.',
    keyGenerator: (req) => {
      const body: unknown = req.body;
      const email =
        body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string'
          ? (body as { email: string }).email.trim().toLowerCase().slice(0, 254)
          : '';
      return `${ipKey(req)}|${email}`;
    },
  });

/** Storefront reads (catalogue browsing). */
export const publicReadLimiter = (perMinute: number) =>
  limiter({ windowMs: 60_000, limit: perMinute, message: 'Too many requests, slow down' });

/** Storefront writes (enquiry submit, payment proof): strict, per IP. */
export const publicWriteLimiter = (per10Min: number) =>
  limiter({
    windowMs: 10 * 60_000,
    limit: per10Min,
    message: 'Too many submissions. Please try again later or call us.',
    keyGenerator: ipKey,
  });
