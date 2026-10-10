import { SignJWT, jwtVerify } from 'jose';
import { ROLES, type Role } from '@sakthimaan/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

const ALG = 'HS256';
const CHALLENGE_TTL_SECONDS = 300;

export interface AccessClaims {
  userId: string;
  role: Role;
  tokenVersion: number;
}

/**
 * Short-lived access JWTs (HS256). `tv` (tokenVersion) lets the server revoke every
 * outstanding token of a user by bumping the counter: password change/reset,
 * "log out everywhere", deactivation.
 *
 * 2FA challenge tokens use a different audience and `typ`, so one can never be
 * used as the other.
 */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly env: Pick<
      Env,
      'JWT_ACCESS_SECRET' | 'JWT_ACCESS_TTL_SECONDS' | 'JWT_ISSUER' | 'JWT_AUDIENCE'
    >,
  ) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  get accessTtlSeconds(): number {
    return this.env.JWT_ACCESS_TTL_SECONDS;
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ role: claims.role, tv: claims.tokenVersion, typ: 'access' })
      .setProtectedHeader({ alg: ALG })
      .setSubject(claims.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Throws jose errors (mapped to TOKEN_EXPIRED / TOKEN_INVALID by the error handler). */
  async verifyAccess(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
      algorithms: [ALG],
    });
    const role = payload.role;
    if (
      payload.typ !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.tv !== 'number' ||
      !ROLES.includes(role as Role)
    ) {
      throw new AppError(401, 'TOKEN_INVALID', 'Invalid token');
    }
    return { userId: payload.sub, role: role as Role, tokenVersion: payload.tv };
  }

  async signTwoFactorChallenge(userId: string, tokenVersion: number): Promise<string> {
    return new SignJWT({ tv: tokenVersion, typ: '2fa' })
      .setProtectedHeader({ alg: ALG })
      .setSubject(userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(`${this.env.JWT_AUDIENCE}:2fa`)
      .setIssuedAt()
      .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyTwoFactorChallenge(token: string): Promise<{ userId: string; tokenVersion: number }> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: this.env.JWT_ISSUER,
      audience: `${this.env.JWT_AUDIENCE}:2fa`,
      algorithms: [ALG],
    });
    if (payload.typ !== '2fa' || typeof payload.sub !== 'string' || typeof payload.tv !== 'number') {
      throw new AppError(401, 'TOKEN_INVALID', 'Invalid verification session');
    }
    return { userId: payload.sub, tokenVersion: payload.tv };
  }
}
