import type { RequestHandler } from 'express';
import type { CaptchaVerifier } from '../providers/captcha/captcha.provider.js';
import { AppError } from '../utils/app-error.js';

/** Captcha check for public write endpoints. Token comes in the `X-Captcha-Token` header. */
export function requireCaptcha(verifier: CaptchaVerifier): RequestHandler {
  return async (req, _res, next) => {
    const token = req.get('x-captcha-token') ?? null;
    const ok = await verifier.verify(token, req.ip);
    if (!ok) throw new AppError(400, 'CAPTCHA_FAILED', 'Captcha verification failed. Please try again.');
    next();
  };
}
