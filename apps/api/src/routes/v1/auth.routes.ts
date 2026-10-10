import { Router, type RequestHandler } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  twoFactorVerifySchema,
  updateMeSchema,
} from '@sakthimaan/shared';
import type { createAuthController } from '../../controllers/auth.controller.js';
import type { ApiDocs } from '../../openapi/registry.js';

const BASE = '/api/v1/auth';
const TAG = 'Auth';

export function createAuthRouter(deps: {
  controller: ReturnType<typeof createAuthController>;
  authenticate: RequestHandler;
  authLimiter: RequestHandler;
  originGuard: RequestHandler;
  docs: ApiDocs;
}): Router {
  const { controller: c, authenticate, authLimiter, originGuard, docs } = deps;
  const r = Router();

  // Credential endpoints: strict per IP+email limiter.
  r.post('/login', authLimiter, c.login);
  r.post('/2fa/verify', authLimiter, c.verifyTwoFactor);
  r.post('/forgot-password', authLimiter, c.forgotPassword);
  r.post('/reset-password', authLimiter, c.resetPassword);

  // Cookie endpoints: CSRF Origin guard.
  r.post('/refresh', originGuard, c.refresh);
  r.post('/logout', originGuard, c.logout);

  // Authenticated.
  r.get('/me', authenticate, c.me);
  r.patch('/me', authenticate, c.updateMe);
  r.post('/change-password', authenticate, authLimiter, c.changePassword);
  r.post('/logout-all', authenticate, c.logoutAll);

  docs.register({
    method: 'post',
    path: `${BASE}/login`,
    tag: TAG,
    auth: 'none',
    body: loginSchema,
    summary: 'Sign in with email and password',
    description:
      'Returns an access token and sets the httpOnly refresh cookie. If 2FA is enabled, returns ' +
      '`{ twoFactorRequired: true, challengeToken }` instead. Locks the account after repeated failures.',
    responses: {
      401: 'Invalid email or password',
      403: 'Account disabled',
      423: 'Account locked',
      429: 'Too many attempts',
    },
  });
  docs.register({
    method: 'post',
    path: `${BASE}/2fa/verify`,
    tag: TAG,
    auth: 'none',
    body: twoFactorVerifySchema,
    summary: 'Complete sign-in with a 2FA code',
    responses: { 401: 'Invalid code or expired challenge' },
  });
  docs.register({
    method: 'post',
    path: `${BASE}/refresh`,
    tag: TAG,
    auth: 'refresh-cookie',
    summary: 'Rotate the refresh cookie and get a new access token',
    description: 'Reusing an already-rotated refresh token revokes the whole session family (TOKEN_REUSED).',
    responses: { 401: 'No / expired / reused refresh token', 403: 'Origin not allowed' },
  });
  docs.register({
    method: 'post',
    path: `${BASE}/logout`,
    tag: TAG,
    auth: 'refresh-cookie',
    summary: 'Sign out this device',
    responses: { 204: 'Signed out' },
  });
  docs.register({
    method: 'post',
    path: `${BASE}/logout-all`,
    tag: TAG,
    auth: 'bearer',
    summary: 'Sign out every device',
    responses: { 204: 'Signed out everywhere' },
  });
  docs.register({
    method: 'post',
    path: `${BASE}/forgot-password`,
    tag: TAG,
    auth: 'none',
    body: forgotPasswordSchema,
    summary: 'Email a password reset link',
    description: 'Always returns the same response, whether or not the email exists.',
  });
  docs.register({
    method: 'post',
    path: `${BASE}/reset-password`,
    tag: TAG,
    auth: 'none',
    body: resetPasswordSchema,
    summary: 'Set a new password with a reset token',
    responses: { 400: 'Invalid or expired link' },
  });
  docs.register({
    method: 'get',
    path: `${BASE}/me`,
    tag: TAG,
    auth: 'bearer',
    summary: 'Current user and permissions',
  });
  docs.register({
    method: 'patch',
    path: `${BASE}/me`,
    tag: TAG,
    auth: 'bearer',
    body: updateMeSchema,
    summary: 'Update own name/phone',
  });
  docs.register({
    method: 'post',
    path: `${BASE}/change-password`,
    tag: TAG,
    auth: 'bearer',
    body: changePasswordSchema,
    summary: 'Change own password',
    description: 'Signs out all other devices and returns a fresh session.',
  });

  return r;
}
