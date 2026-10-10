import cors from 'cors';
import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

/**
 * Two CORS policies:
 * - admin:  admin-panel origins, credentials allowed (refresh cookie)
 * - public: customer-website origins, no credentials
 * Requests from other origins get no CORS headers, so browsers block them.
 */
export function adminCors(origins: readonly string[]): RequestHandler {
  return cors({
    origin: [...origins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After', 'Content-Disposition'],
    maxAge: 600,
  });
}

export function publicCors(origins: readonly string[]): RequestHandler {
  return cors({
    origin: [...origins],
    credentials: false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Request-Id', 'X-Captcha-Token'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  });
}

/**
 * CSRF guard for cookie-authenticated endpoints (refresh, logout). Browsers always send
 * `Origin` on cross-site POSTs, so a forged request from another site carries a foreign
 * Origin and is rejected. Requests without Origin come from non-browser clients, which
 * cannot hold the victim's cookie.
 */
export function requireAllowedOrigin(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin !== undefined && !allowed.has(origin)) {
      next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
      return;
    }
    next();
  };
}
