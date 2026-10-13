import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Types } from 'mongoose';
import {
  permissionsForRole,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type Role,
  type TwoFactorVerifyInput,
  type UpdateMeInput,
} from '@sakthimaan/shared';
import type { Env } from '../config/env.js';
import type { Logger } from '../config/logger.js';
import type { RequestMeta } from '../middlewares/request-context.js';
import { RefreshTokenModel, UserModel } from '../models/index.js';
import type { Mailer } from '../providers/mail/mailer.js';
import type { TwoFactorProviders } from '../providers/two-factor/two-factor.provider.js';
import { AppError, unauthorized } from '../utils/app-error.js';
import { SecretBox, randomToken, sha256 } from '../utils/crypto.js';
import type { AuditActor, AuditService } from './audit.service.js';
import type { TokenService } from './token.service.js';

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUser;
}

export type LoginOutcome =
  { kind: 'session'; session: IssuedSession } | { kind: 'two_factor'; challengeToken: string };

interface UserForAuth {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  isActive: boolean;
  tokenVersion: number;
  lastLoginAt?: Date | null;
}

const AUTH_FIELDS = 'name email phone role isActive tokenVersion lastLoginAt';

export function toAuthUser(u: UserForAuth): AuthUser {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role,
    permissions: [...permissionsForRole(u.role)],
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  };
}

const actorOf = (u: UserForAuth): AuditActor => ({ user: String(u._id), name: u.name, role: u.role });

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

export interface AuthServiceDeps {
  env: Pick<
    Env,
    | 'BCRYPT_COST'
    | 'LOGIN_MAX_ATTEMPTS'
    | 'LOGIN_LOCK_MINUTES'
    | 'PASSWORD_RESET_TTL_MINUTES'
    | 'REFRESH_TOKEN_TTL_DAYS'
    | 'REFRESH_REUSE_GRACE_SECONDS'
    | 'JWT_ACCESS_SECRET'
    | 'ADMIN_APP_URL'
  >;
  logger: Logger;
  tokens: TokenService;
  audit: AuditService;
  mailer: Mailer;
  twoFactor: TwoFactorProviders;
  /** Store name for emails (from Settings). */
  storeName?: () => Promise<string | null>;
}

export class AuthService {
  /** Compared against when the email is unknown, so response time doesn't reveal which emails exist. */
  private readonly dummyHash: Promise<string>;
  /** Encrypts the rotated pair kept for the refresh grace window. */
  private readonly graceBox: SecretBox;

  constructor(private readonly deps: AuthServiceDeps) {
    this.dummyHash = bcrypt.hash(randomToken(16), deps.env.BCRYPT_COST);
    this.graceBox = new SecretBox(deps.env.JWT_ACCESS_SECRET, 'refresh-grace');
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.deps.env.BCRYPT_COST);
  }

  // ---------------------------------------------------------------- login

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginOutcome> {
    const user = await UserModel.findOne({ email: input.email }).select(
      `+passwordHash ${AUTH_FIELDS} failedLoginAttempts lockUntil twoFactor.enabled twoFactor.method`,
    );

    if (!user) {
      await bcrypt.compare(input.password, await this.dummyHash);
      await this.deps.audit.recordSafely(
        {
          action: 'login_failed',
          entity: 'user',
          entityLabel: input.email,
          meta: { reason: 'unknown_email' },
        },
        meta,
      );
      throw invalidCredentials();
    }

    if (user.lockUntil && user.lockUntil > new Date()) throw this.lockedError(user.lockUntil);

    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      const lockedUntil = await this.registerFailedLogin(user._id);
      await this.deps.audit.recordSafely(
        {
          actor: actorOf(user),
          action: 'login_failed',
          entity: 'user',
          entityId: String(user._id),
          entityLabel: user.email,
          meta: { reason: 'bad_password', locked: lockedUntil !== null },
        },
        meta,
      );
      if (lockedUntil) throw this.lockedError(lockedUntil);
      throw invalidCredentials();
    }

    // Checked only after the password, so disabled accounts aren't revealed to guessers.
    if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');

    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      await UserModel.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0, lockUntil: null } });
    }

    if (user.twoFactor?.enabled) {
      const provider = user.twoFactor.method ? this.deps.twoFactor[user.twoFactor.method] : undefined;
      if (!provider) {
        throw new AppError(
          503,
          'TWO_FACTOR_UNAVAILABLE',
          'Two-factor verification is not available right now',
        );
      }
      await provider.sendChallenge({ id: String(user._id), email: user.email, phone: user.phone ?? null });
      const challengeToken = await this.deps.tokens.signTwoFactorChallenge(
        String(user._id),
        user.tokenVersion,
      );
      return { kind: 'two_factor', challengeToken };
    }

    return { kind: 'session', session: await this.startSession(user, meta) };
  }

  async verifyTwoFactor(input: TwoFactorVerifyInput, meta: RequestMeta): Promise<IssuedSession> {
    const claims = await this.deps.tokens.verifyTwoFactorChallenge(input.challengeToken);
    const user = await UserModel.findById(claims.userId).select(
      `${AUTH_FIELDS} twoFactor.enabled twoFactor.method +twoFactor.secretEncrypted`,
    );
    if (!user || !user.isActive || user.tokenVersion !== claims.tokenVersion || !user.twoFactor?.enabled) {
      throw unauthorized('TOKEN_INVALID', 'Verification session is no longer valid. Sign in again.');
    }
    const provider = user.twoFactor.method ? this.deps.twoFactor[user.twoFactor.method] : undefined;
    if (!provider)
      throw new AppError(503, 'TWO_FACTOR_UNAVAILABLE', 'Two-factor verification is not available');

    const ok = await provider.verify(
      { id: String(user._id), secretEncrypted: user.twoFactor.secretEncrypted ?? null },
      input.code,
    );
    if (!ok) {
      await this.deps.audit.recordSafely(
        {
          actor: actorOf(user),
          action: 'login_failed',
          entity: 'user',
          entityId: String(user._id),
          meta: { reason: 'bad_2fa_code' },
        },
        meta,
      );
      throw new AppError(401, 'TWO_FACTOR_INVALID', 'Incorrect verification code');
    }
    return this.startSession(user, meta);
  }

  // ---------------------------------------------------------------- sessions

  /**
   * Rotates a refresh token.
   *
   * 1. The replacement token is created first, then the presented token is claimed
   *    atomically (`revokedAt: null` → now), so only one concurrent request can rotate it.
   * 2. The winner stores the new pair, AES-GCM encrypted, on the old token (`graceCipher`).
   * 3. Presenting the old token again **within the grace window** (two tabs, a retried
   *    request) returns that same pair, as long as the replacement is still live.
   * 4. Presenting it after the window, or after the replacement was itself rotated or
   *    revoked, is treated as theft: the whole family is revoked (TOKEN_REUSED).
   */
  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!rawToken) throw unauthorized('UNAUTHORIZED', 'Not signed in');
    const now = new Date();
    const current = await RefreshTokenModel.findOne({ tokenHash: sha256(rawToken) })
      .select('+graceCipher')
      .lean();
    if (!current) throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
    if (current.revokedAt) return this.resolveRotatedToken(current, meta);
    if (current.expiresAt <= now)
      throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');

    const user = await UserModel.findById(current.user).select(AUTH_FIELDS).lean();
    if (!user || !user.isActive || user.tokenVersion !== current.tokenVersion) {
      await this.revokeFamily(current.familyId);
      throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
    }

    const nextRaw = randomToken(48);
    const session = await this.issueSession(user, meta, current.familyId, nextRaw);
    const claimed = await RefreshTokenModel.findOneAndUpdate(
      { _id: current._id, revokedAt: null },
      {
        $set: {
          revokedAt: now,
          replacedByHash: sha256(nextRaw),
          graceCipher: this.graceBox.seal(
            JSON.stringify({
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
              refreshExpiresAt: session.refreshExpiresAt.toISOString(),
            }),
          ),
        },
      },
    ).lean();

    if (!claimed) {
      // Lost the race to a concurrent refresh: discard our replacement and use the winner's.
      await RefreshTokenModel.deleteOne({ tokenHash: sha256(nextRaw) });
      const winner = await RefreshTokenModel.findById(current._id).select('+graceCipher').lean();
      if (!winner) throw unauthorized('TOKEN_INVALID', 'Session expired. Please sign in again.');
      return this.resolveRotatedToken(winner, meta);
    }
    return session;
  }

  /** A rotated token was presented: replay the stored pair inside the grace window, else revoke. */
  private async resolveRotatedToken(
    token: {
      _id: Types.ObjectId;
      user: Types.ObjectId;
      familyId: string;
      revokedAt?: Date | null;
      replacedByHash?: string | null;
      graceCipher?: string | null;
    },
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const graceMs = this.deps.env.REFRESH_REUSE_GRACE_SECONDS * 1000;
    const now = Date.now();
    const inWindow =
      graceMs > 0 &&
      token.revokedAt != null &&
      now - token.revokedAt.getTime() <= graceMs &&
      token.replacedByHash != null &&
      token.graceCipher != null;

    if (inWindow) {
      const replacement = await RefreshTokenModel.findOne({ tokenHash: token.replacedByHash }).lean();
      const user = await UserModel.findById(token.user).select(AUTH_FIELDS).lean();
      const live =
        replacement &&
        !replacement.revokedAt &&
        replacement.expiresAt.getTime() > now &&
        user?.isActive &&
        user.tokenVersion === replacement.tokenVersion;
      const pair = live ? this.openGracePair(token.graceCipher) : null;
      if (user && pair) {
        this.deps.logger.info(
          { userId: String(token.user), requestId: meta.requestId },
          'Refresh token re-presented within grace window; returning the current pair',
        );
        return {
          accessToken: pair.accessToken,
          expiresIn: this.deps.tokens.accessTtlSeconds,
          refreshToken: pair.refreshToken,
          refreshExpiresAt: new Date(pair.refreshExpiresAt),
          user: toAuthUser(user),
        };
      }
    }

    await this.revokeFamily(token.familyId);
    this.deps.logger.warn(
      { userId: String(token.user), familyId: token.familyId, requestId: meta.requestId },
      'Refresh token reuse detected; session family revoked',
    );
    throw unauthorized('TOKEN_REUSED', 'Session ended for security reasons. Please sign in again.');
  }

  private openGracePair(
    cipher: string | null | undefined,
  ): { accessToken: string; refreshToken: string; refreshExpiresAt: string } | null {
    if (!cipher) return null;
    try {
      const parsed: unknown = JSON.parse(this.graceBox.open(cipher));
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as Record<string, unknown>).accessToken === 'string' &&
        typeof (parsed as Record<string, unknown>).refreshToken === 'string' &&
        typeof (parsed as Record<string, unknown>).refreshExpiresAt === 'string'
      ) {
        return parsed as { accessToken: string; refreshToken: string; refreshExpiresAt: string };
      }
    } catch (err) {
      this.deps.logger.error({ err }, 'Could not open refresh grace cipher');
    }
    return null;
  }

  /** Revokes the session family of the presented refresh token (this device). */
  async logout(
    rawToken: string | undefined,
    actor: AuditActor | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    if (!rawToken) return;
    const token = await RefreshTokenModel.findOne({ tokenHash: sha256(rawToken) }).lean();
    if (!token) return;
    await this.revokeFamily(token.familyId);
    await this.deps.audit.recordSafely(
      { actor, action: 'logout', entity: 'user', entityId: String(token.user) },
      meta,
    );
  }

  /** Ends every session of the user on every device. */
  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { $inc: { tokenVersion: 1 } },
      { returnDocument: 'after' },
    )
      .select(AUTH_FIELDS)
      .lean();
    if (!user) throw unauthorized();
    await this.revokeAllForUser(userId);
    await this.deps.audit.record(
      {
        actor: actorOf(user),
        action: 'logout',
        entity: 'user',
        entityId: userId,
        meta: { allDevices: true },
      },
      meta,
    );
  }

  // ---------------------------------------------------------------- passwords

  /** Always resolves the same way whether or not the email exists (no account enumeration). */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await UserModel.findOne({ email, isActive: true }).select(AUTH_FIELDS).lean();
    if (!user) return;

    const raw = randomToken(32);
    const expiresAt = new Date(Date.now() + this.deps.env.PASSWORD_RESET_TTL_MINUTES * 60_000);
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { 'passwordReset.tokenHash': sha256(raw), 'passwordReset.expiresAt': expiresAt } },
    );

    const link = new URL('/reset-password', this.deps.env.ADMIN_APP_URL);
    link.searchParams.set('token', raw);
    // Not awaited: keeps the response time independent of whether a mail was sent.
    const store = (await this.deps.storeName?.().catch(() => null)) ?? null;
    this.deps.mailer
      .send({
        ...(store ? { fromName: store } : {}),
        to: user.email,
        subject: store ? `Reset your ${store} admin password` : 'Reset your admin password',
        text:
          `Hello ${user.name},\n\nUse this link to set a new password. It expires in ` +
          `${this.deps.env.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once:\n\n${link.toString()}\n\n` +
          `If you didn't ask for this, you can ignore this email.`,
      })
      .catch((err: unknown) => this.deps.logger.error({ err }, 'Failed to send password reset email'));

    await this.deps.audit.recordSafely(
      {
        actor: actorOf(user),
        action: 'password_reset',
        entity: 'user',
        entityId: String(user._id),
        meta: { stage: 'requested' },
      },
      meta,
    );
  }

  /** One-time use: the token is consumed atomically together with the password change. */
  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const passwordHash = await this.hashPassword(input.password);
    const user = await UserModel.findOneAndUpdate(
      {
        'passwordReset.tokenHash': sha256(input.token),
        'passwordReset.expiresAt': { $gt: new Date() },
        isActive: true,
      },
      {
        $set: { passwordHash, passwordChangedAt: new Date(), failedLoginAttempts: 0, lockUntil: null },
        $unset: { passwordReset: 1 },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after' },
    )
      .select(AUTH_FIELDS)
      .lean();
    if (!user) {
      throw new AppError(
        400,
        'INVALID_RESET_TOKEN',
        'This reset link is invalid or has expired. Request a new one.',
      );
    }
    await this.revokeAllForUser(String(user._id));
    await this.deps.audit.record(
      {
        actor: actorOf(user),
        action: 'password_reset',
        entity: 'user',
        entityId: String(user._id),
        meta: { stage: 'completed' },
      },
      meta,
    );
  }

  /** Changes the password, ends all other sessions, and returns a fresh session for this device. */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const user = await UserModel.findById(userId).select(`+passwordHash ${AUTH_FIELDS}`);
    if (!user || !user.isActive) throw unauthorized();
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [
        {
          location: 'body',
          path: 'currentPassword',
          message: 'Current password is incorrect',
          code: 'custom',
        },
      ]);
    }
    const updated = await UserModel.findByIdAndUpdate(
      userId,
      {
        $set: { passwordHash: await this.hashPassword(input.newPassword), passwordChangedAt: new Date() },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after' },
    )
      .select(AUTH_FIELDS)
      .lean();
    if (!updated) throw unauthorized();
    await this.revokeAllForUser(userId);
    await this.deps.audit.record(
      {
        actor: actorOf(updated),
        action: 'update',
        entity: 'user',
        entityId: userId,
        summary: 'Changed own password',
      },
      meta,
    );
    return this.issueSession(updated, meta, randomUUID(), randomToken(48));
  }

  // ---------------------------------------------------------------- profile

  async me(userId: string): Promise<AuthUser> {
    const user = await UserModel.findById(userId).select(AUTH_FIELDS).lean();
    if (!user || !user.isActive) throw unauthorized();
    return toAuthUser(user);
  }

  async updateMe(userId: string, input: UpdateMeInput, meta: RequestMeta): Promise<AuthUser> {
    const before = await UserModel.findById(userId).select(AUTH_FIELDS).lean();
    if (!before || !before.isActive) throw unauthorized();
    const after = await UserModel.findByIdAndUpdate(
      userId,
      { $set: input },
      { returnDocument: 'after', runValidators: true },
    )
      .select(AUTH_FIELDS)
      .lean();
    if (!after) throw unauthorized();
    const changes = (Object.keys(input) as (keyof UpdateMeInput)[])
      .filter((k) => before[k] !== after[k])
      .map((k) => ({ path: k, from: before[k] ?? null, to: after[k] ?? null }));
    if (changes.length > 0) {
      await this.deps.audit.record(
        {
          actor: actorOf(after),
          action: 'update',
          entity: 'user',
          entityId: userId,
          summary: 'Updated own profile',
          changes,
        },
        meta,
      );
    }
    return toAuthUser(after);
  }

  // ---------------------------------------------------------------- internals

  private lockedError(until: Date): AppError {
    const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    return new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s) or reset your password.`,
      { retryAfterSeconds: seconds },
      { 'Retry-After': String(seconds) },
    );
  }

  /** Increments the failure counter; locks the account when it reaches the limit. Returns the lock expiry, if locked. */
  private async registerFailedLogin(userId: Types.ObjectId): Promise<Date | null> {
    const updated = await UserModel.findByIdAndUpdate(
      userId,
      { $inc: { failedLoginAttempts: 1 } },
      { returnDocument: 'after' },
    )
      .select('failedLoginAttempts')
      .lean();
    if (!updated || updated.failedLoginAttempts < this.deps.env.LOGIN_MAX_ATTEMPTS) return null;
    const lockUntil = new Date(Date.now() + this.deps.env.LOGIN_LOCK_MINUTES * 60_000);
    await UserModel.updateOne({ _id: userId }, { $set: { lockUntil, failedLoginAttempts: 0 } });
    return lockUntil;
  }

  private async startSession(user: UserForAuth, meta: RequestMeta): Promise<IssuedSession> {
    await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), lastLoginIp: meta.ip } });
    await this.deps.audit.recordSafely(
      {
        actor: actorOf(user),
        action: 'login',
        entity: 'user',
        entityId: String(user._id),
        entityLabel: user.email,
      },
      meta,
    );
    return this.issueSession(user, meta, randomUUID(), randomToken(48));
  }

  private async issueSession(
    user: UserForAuth,
    meta: RequestMeta,
    familyId: string,
    refreshToken: string,
  ): Promise<IssuedSession> {
    const refreshExpiresAt = new Date(Date.now() + this.deps.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await RefreshTokenModel.create({
      user: user._id,
      familyId,
      tokenHash: sha256(refreshToken),
      tokenVersion: user.tokenVersion,
      expiresAt: refreshExpiresAt,
      createdByIp: meta.ip,
      userAgent: meta.userAgent,
    });
    const accessToken = await this.deps.tokens.signAccess({
      userId: String(user._id),
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    return {
      accessToken,
      expiresIn: this.deps.tokens.accessTtlSeconds,
      refreshToken,
      refreshExpiresAt,
      user: toAuthUser(user),
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await RefreshTokenModel.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await RefreshTokenModel.updateMany(
      { user: userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
}
