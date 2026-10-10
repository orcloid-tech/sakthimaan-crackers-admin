/**
 * Captcha hook for public write endpoints. Only `none` exists today; a provider
 * (e.g. Cloudflare Turnstile or hCaptcha, both with free tiers) can be added by
 * implementing this interface and selecting it with CAPTCHA_PROVIDER.
 */
export interface CaptchaVerifier {
  readonly name: string;
  verify(token: string | null, ip: string | undefined): Promise<boolean>;
}

/** Accepts everything. Rate limits still apply. */
export class NoopCaptchaVerifier implements CaptchaVerifier {
  readonly name = 'none';
  async verify(): Promise<boolean> {
    return true;
  }
}

export function createCaptchaVerifier(provider: 'none'): CaptchaVerifier {
  switch (provider) {
    case 'none':
      return new NoopCaptchaVerifier();
  }
}
