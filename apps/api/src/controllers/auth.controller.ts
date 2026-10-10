import type { CookieOptions, Request, Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  twoFactorVerifySchema,
  updateMeSchema,
  type LoginResult,
  type RefreshResult,
} from '@sakthimaan/shared';
import type { Env } from '../config/env.js';
import { authOf } from '../middlewares/auth.js';
import { requestMeta } from '../middlewares/request-context.js';
import { validated } from '../middlewares/validate.js';
import type { AuthService, IssuedSession } from '../services/auth.service.js';
import { sendNoContent, sendOk } from '../utils/http.js';

/** Path-scoped so the refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function createAuthController(
  auth: AuthService,
  env: Pick<Env, 'REFRESH_COOKIE_NAME' | 'COOKIE_SECURE' | 'COOKIE_SAMESITE' | 'COOKIE_DOMAIN'>,
) {
  const cookieOptions = (expires?: Date): CookieOptions => ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: REFRESH_COOKIE_PATH,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    ...(expires ? { expires } : {}),
  });

  const setRefreshCookie = (res: Response, session: IssuedSession) =>
    res.cookie(env.REFRESH_COOKIE_NAME, session.refreshToken, cookieOptions(session.refreshExpiresAt));

  const clearRefreshCookie = (res: Response) => res.clearCookie(env.REFRESH_COOKIE_NAME, cookieOptions());

  const readRefreshCookie = (req: Request): string | undefined => {
    const value: unknown = req.cookies?.[env.REFRESH_COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;
  };

  const sessionBody = (s: IssuedSession): RefreshResult => ({
    accessToken: s.accessToken,
    expiresIn: s.expiresIn,
    user: s.user,
  });

  return {
    login: validated({ body: loginSchema }, async ({ body }, req, res) => {
      const outcome = await auth.login(body, requestMeta(req));
      if (outcome.kind === 'two_factor') {
        const data: LoginResult = { twoFactorRequired: true, challengeToken: outcome.challengeToken };
        sendOk(res, data);
        return;
      }
      setRefreshCookie(res, outcome.session);
      const data: LoginResult = { twoFactorRequired: false, ...sessionBody(outcome.session) };
      sendOk(res, data);
    }),

    verifyTwoFactor: validated({ body: twoFactorVerifySchema }, async ({ body }, req, res) => {
      const session = await auth.verifyTwoFactor(body, requestMeta(req));
      setRefreshCookie(res, session);
      const data: LoginResult = { twoFactorRequired: false, ...sessionBody(session) };
      sendOk(res, data);
    }),

    refresh: async (req: Request, res: Response) => {
      try {
        const session = await auth.refresh(readRefreshCookie(req), requestMeta(req));
        setRefreshCookie(res, session);
        sendOk(res, sessionBody(session));
      } catch (err) {
        clearRefreshCookie(res); // a dead cookie is useless; stop the browser resending it
        throw err;
      }
    },

    logout: async (req: Request, res: Response) => {
      await auth.logout(readRefreshCookie(req), undefined, requestMeta(req));
      clearRefreshCookie(res);
      sendNoContent(res);
    },

    logoutAll: async (req: Request, res: Response) => {
      await auth.logoutAll(authOf(req).userId, requestMeta(req));
      clearRefreshCookie(res);
      sendNoContent(res);
    },

    forgotPassword: validated({ body: forgotPasswordSchema }, async ({ body }, req, res) => {
      await auth.forgotPassword(body.email, requestMeta(req));
      sendOk(res, { message: 'If that email belongs to an active account, a reset link has been sent.' });
    }),

    resetPassword: validated({ body: resetPasswordSchema }, async ({ body }, req, res) => {
      await auth.resetPassword(body, requestMeta(req));
      clearRefreshCookie(res);
      sendOk(res, { message: 'Password updated. Please sign in with your new password.' });
    }),

    changePassword: validated({ body: changePasswordSchema }, async ({ body }, req, res) => {
      const session = await auth.changePassword(authOf(req).userId, body, requestMeta(req));
      setRefreshCookie(res, session);
      sendOk(res, sessionBody(session));
    }),

    me: async (req: Request, res: Response) => {
      sendOk(res, await auth.me(authOf(req).userId));
    },

    updateMe: validated({ body: updateMeSchema }, async ({ body }, req, res) => {
      sendOk(res, await auth.updateMe(authOf(req).userId, body, requestMeta(req)));
    }),
  };
}
