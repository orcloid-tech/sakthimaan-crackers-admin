import cors from 'cors';
import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

/**
 * Two CORS policies:
 * - admin:  admin-panel origins, credentials allowed (refresh cookie)
 * - public: customer-website origins, no credentials
 * Requests from other origins get no CORS headers, so browsers block them.
 */

export interface OriginPolicy {
  origins: readonly string[];
  /**
   * Development only (DEV_ALLOW_LAN_ORIGINS): also accept the admin served from this
   * machine's private network address (e.g. http://192.168.1.20:5173), so it can be
   * tested on a phone over Wi-Fi. Env validation forbids it in production.
   */
  allowLan: boolean;
}

/** http://localhost, 127.0.0.1, 10.x.x.x, 172.16–31.x.x, 192.168.x.x (any port). */
export function isPrivateNetworkOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || url.pathname !== '/' || url.username || url.password) return false;
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a = -1, b = -1] = parts;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isAllowedOrigin(origin: string, policy: OriginPolicy): boolean {
  return policy.origins.includes(origin) || (policy.allowLan && isPrivateNetworkOrigin(origin));
}

export function adminCors(policy: OriginPolicy): RequestHandler {
  return cors({
    origin: (origin, cb) => {
      cb(null, origin === undefined || isAllowedOrigin(origin, policy));
    },
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
export function requireAllowedOrigin(policy: OriginPolicy): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin !== undefined && !isAllowedOrigin(origin, policy)) {
      next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
      return;
    }
    next();
  };
}
