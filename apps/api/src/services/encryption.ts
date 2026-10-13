import type { Env } from '../config/env.js';
import type { Logger } from '../config/logger.js';
import { SecretBox } from '../utils/crypto.js';

/** What each derived key is used for; a new use gets its own purpose (and so its own key). */
export type EncryptionPurpose = 'refresh-grace' | 'two-factor';

/**
 * Data encryption at rest (AES-256-GCM), keyed by ENCRYPTION_KEY only. It is separate from
 * the JWT signing secret on purpose: rotating JWT_ACCESS_SECRET signs everyone out but
 * never makes stored encrypted data (e.g. future 2FA secrets) unreadable. Each purpose
 * gets its own key derived with HKDF, so one use can never decrypt another's data.
 */
export class Encryption {
  private readonly boxes = new Map<EncryptionPurpose, SecretBox>();

  constructor(private readonly key: string) {}

  box(purpose: EncryptionPurpose): SecretBox {
    let b = this.boxes.get(purpose);
    if (!b) {
      b = new SecretBox(this.key, purpose);
      this.boxes.set(purpose, b);
    }
    return b;
  }
}

/** Problems that must stop a production start (checked in server.ts and createApp). */
export function encryptionStartupErrors(env: Pick<Env, 'isProduction' | 'ENCRYPTION_KEY'>): string[] {
  return env.isProduction && !env.ENCRYPTION_KEY
    ? [
        "ENCRYPTION_KEY: Required in production. Generate one: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
      ]
    : [];
}

/**
 * Production: ENCRYPTION_KEY is required (createApp refuses otherwise). Development and
 * tests may leave it unset; a stand-in key is then derived from the JWT secret, with a
 * warning, so local sessions still work. Set ENCRYPTION_KEY to test rotation behaviour.
 */
export function createEncryption(env: Env, logger?: Logger): Encryption {
  const problems = encryptionStartupErrors(env);
  if (problems.length) throw new Error(problems.join('\n'));
  if (env.ENCRYPTION_KEY) return new Encryption(env.ENCRYPTION_KEY);
  logger?.warn('ENCRYPTION_KEY is not set: using a development-only key. Set it before going live.');
  return new Encryption(`dev-only-encryption-key:${env.JWT_ACCESS_SECRET}`);
}
