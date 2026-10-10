/**
 * Optional 2FA hook. When a user has `twoFactor.enabled`, login returns a short-lived
 * challenge token instead of a session; the client then calls POST /auth/2fa/verify
 * with the code, which is checked by the provider for the user's `twoFactor.method`.
 * No provider ships today (enrolment UI comes later); TOTP needs no paid service.
 */
export interface TwoFactorProvider {
  readonly method: 'totp' | 'email_otp' | 'sms_otp';
  /** Send a code if the method needs one (email/SMS). TOTP does nothing. */
  sendChallenge(user: { id: string; email: string; phone?: string | null }): Promise<void>;
  verify(user: { id: string; secretEncrypted?: string | null }, code: string): Promise<boolean>;
}

export type TwoFactorProviders = Partial<Record<TwoFactorProvider['method'], TwoFactorProvider>>;
