import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel, RefreshTokenModel, UserModel } from '../src/models/index.js';
import type { TwoFactorProvider } from '../src/providers/two-factor/two-factor.provider.js';
import {
  ADMIN_ORIGIN,
  PASSWORD,
  buildTestApp,
  createUser,
  refreshCookie,
  setCookieHeader,
} from './helpers/app.js';
import { clearCollections, useTestDb } from './helpers/db.js';

useTestDb();

const { app, mailer } = buildTestApp();

beforeEach(async () => {
  await clearCollections('users', 'refreshtokens', 'auditlogs');
});

async function login(email: string, password = PASSWORD) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

async function refresh(cookie: string | undefined, origin = ADMIN_ORIGIN) {
  const req = request(app).post('/api/v1/auth/refresh').set('Origin', origin);
  return cookie ? req.set('Cookie', `smc_rt=${encodeURIComponent(cookie)}`) : req;
}

describe('POST /auth/login', () => {
  it('returns an access token, user + permissions, and an httpOnly path-scoped refresh cookie', async () => {
    const { email } = await createUser({ role: 'staff_orders' });
    const res = await login(email.toUpperCase()); // emails are case-insensitive

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ twoFactorRequired: false, expiresIn: 900 });
    expect(res.body.data.accessToken).toMatch(/^ey/);
    expect(res.body.data.user).toMatchObject({ email, role: 'staff_orders' });
    expect(res.body.data.user.permissions).toContain('orders:confirm');
    expect(res.body.data.user.permissions).not.toContain('orders:pack_unpaid');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');

    const cookie = setCookieHeader(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(await AuditLogModel.countDocuments({ action: 'login' })).toBe(1);
  });

  it('gives the same error for unknown email and wrong password (no enumeration)', async () => {
    const { email } = await createUser();
    const wrong = await login(email, 'not-the-password-1');
    const unknown = await login('nobody@example.com', 'whatever-123');
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }
    expect(await AuditLogModel.countDocuments({ action: 'login_failed' })).toBe(2);
  });

  it('locks the account after 5 failed attempts, even for the right password, then unlocks', async () => {
    const { user, email } = await createUser();
    for (let i = 1; i <= 4; i++) expect((await login(email, `wrong-pass-${i}`)).status).toBe(401);

    const fifth = await login(email, 'wrong-pass-5');
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(800);

    expect((await login(email)).status).toBe(423); // correct password still refused

    await UserModel.updateOne({ _id: user._id }, { lockUntil: new Date(Date.now() - 1000) });
    expect((await login(email)).status).toBe(200);
    const after = await UserModel.findById(user._id).lean();
    expect(after).toMatchObject({ failedLoginAttempts: 0, lockUntil: null });
  });

  it('refuses disabled accounts (after checking the password)', async () => {
    const { email } = await createUser({ isActive: false });
    expect((await login(email, 'wrong-pass-1')).body.error.code).toBe('INVALID_CREDENTIALS');
    const res = await login(email);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('validates input with field-level details and rejects unknown/operator fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email', extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password']));

    const injection = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $ne: null } });
    expect(injection.status).toBe(400);
    expect(injection.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('authenticated requests', () => {
  it('GET /auth/me requires a valid bearer token', async () => {
    const { email } = await createUser({ role: 'viewer' });
    const token = (await login(email)).body.data.accessToken as string;

    expect((await request(app).get('/api/v1/auth/me')).body.error.code).toBe('UNAUTHORIZED');
    const tampered = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token.slice(0, -2)}xx`);
    expect(tampered.status).toBe(401);
    expect(tampered.body.error.code).toBe('TOKEN_INVALID');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ email, role: 'viewer' });
  });

  it('deactivation and logout-all take effect immediately for existing access tokens', async () => {
    const { user, email } = await createUser();
    const token = (await login(email)).body.data.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request(app).post('/api/v1/auth/logout-all').set(auth)).status).toBe(204);
    expect((await request(app).get('/api/v1/auth/me').set(auth)).body.error.code).toBe('TOKEN_INVALID');

    const token2 = (await login(email)).body.data.accessToken as string;
    await UserModel.updateOne({ _id: user._id }, { isActive: false });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token2}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('PATCH /auth/me updates the profile and audits the diff', async () => {
    const { email } = await createUser();
    const token = (await login(email)).body.data.accessToken as string;
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Murugan', phone: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Murugan', phone: '9876543210' });
    const entry = await AuditLogModel.findOne({ action: 'update', entity: 'user' }).lean();
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['name', 'phone']);
  });
});

describe('refresh token rotation', () => {
  it('rotates the cookie and issues a working access token', async () => {
    const { email } = await createUser();
    const first = refreshCookie(await login(email));
    const res = await refresh(first);
    expect(res.status).toBe(200);
    const second = refreshCookie(res);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('detects reuse after the grace window and revokes the whole family', async () => {
    const { email } = await createUser();
    const first = refreshCookie(await login(email));
    const second = refreshCookie(await refresh(first));

    // Move the rotation 31 s into the past (grace window is 30 s).
    await RefreshTokenModel.updateOne(
      { replacedByHash: { $ne: null } },
      { revokedAt: new Date(Date.now() - 31_000) },
    );

    const replay = await refresh(first); // attacker replays the stolen old token
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');

    const legit = await refresh(second); // the legitimate holder is logged out too
    expect(legit.status).toBe(401);
    expect(await RefreshTokenModel.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('grace window: concurrent refreshes with the same cookie get the same new pair', async () => {
    const { email } = await createUser();
    const first = refreshCookie(await login(email));

    const [a, b] = await Promise.all([refresh(first), refresh(first)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refreshCookie(a)).toBeDefined();
    expect(refreshCookie(b)).toBe(refreshCookie(a));
    expect(b.body.data.accessToken).toBe(a.body.data.accessToken);

    // Exactly one live token remains (no orphan from the losing request), and it works.
    expect(await RefreshTokenModel.countDocuments({ revokedAt: null })).toBe(1);
    const next = await refresh(refreshCookie(a));
    expect(next.status).toBe(200);
  });

  it('grace window: re-presenting the old token shortly after returns the same pair', async () => {
    const { email } = await createUser();
    const first = refreshCookie(await login(email));
    const rotated = await refresh(first);
    const retried = await refresh(first); // e.g. the first response was lost on a flaky network
    expect(retried.status).toBe(200);
    expect(refreshCookie(retried)).toBe(refreshCookie(rotated));
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${retried.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('grace window does not apply once the replacement itself was rotated', async () => {
    const { email } = await createUser();
    const first = refreshCookie(await login(email));
    const second = refreshCookie(await refresh(first));
    await refresh(second); // legitimate client moves on: `second` is now rotated too

    const replay = await refresh(first); // still within 30 s of the first rotation
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');
    expect(await RefreshTokenModel.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('grace window can be disabled (REFRESH_REUSE_GRACE_SECONDS=0)', async () => {
    const { app: strict } = buildTestApp({ env: { REFRESH_REUSE_GRACE_SECONDS: '0' } });
    const { email } = await createUser();
    const loginRes = await request(strict).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    const first = refreshCookie(loginRes)!;
    const call = () =>
      request(strict)
        .post('/api/v1/auth/refresh')
        .set('Origin', ADMIN_ORIGIN)
        .set('Cookie', `smc_rt=${encodeURIComponent(first)}`);
    expect((await call()).status).toBe(200);
    expect((await call()).body.error.code).toBe('TOKEN_REUSED');
  });

  it('a logged-out token is never replayed, even within the window', async () => {
    const { email } = await createUser();
    const first = refreshCookie(await login(email));
    await refresh(first);
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', `smc_rt=${encodeURIComponent(first!)}`);
    expect((await refresh(first)).status).toBe(401);
  });

  it('rejects missing/unknown cookies and foreign origins (CSRF guard)', async () => {
    const { email } = await createUser();
    const cookie = refreshCookie(await login(email));
    expect((await refresh(undefined)).body.error.code).toBe('UNAUTHORIZED');
    expect((await refresh('x'.repeat(64))).body.error.code).toBe('TOKEN_INVALID');
    const csrf = await refresh(cookie, 'https://evil.example');
    expect(csrf.status).toBe(403);
    expect(csrf.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect((await refresh(cookie)).status).toBe(200); // still valid: the forged call did nothing
  });

  it('logout revokes the session and clears the cookie', async () => {
    const { email } = await createUser();
    const cookie = refreshCookie(await login(email));
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', `smc_rt=${encodeURIComponent(cookie!)}`);
    expect(res.status).toBe(204);
    expect(setCookieHeader(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe('password reset & change', () => {
  it('forgot-password responds identically for unknown emails and sends nothing', async () => {
    const before = mailer.sent.length;
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/If that email/);
    expect(mailer.sent.length).toBe(before);
  });

  it('full reset flow: link by email, one-time use, old password and sessions invalidated', async () => {
    const { email } = await createUser();
    const oldCookie = refreshCookie(await login(email));

    await request(app).post('/api/v1/auth/forgot-password').send({ email }).expect(200);
    await new Promise((r) => setTimeout(r, 10)); // mail is sent without awaiting
    const mail = mailer.sent.at(-1)!;
    expect(mail.to).toBe(email);
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
    expect(token).toBeDefined();

    const newPassword = 'Crackers2027Boom';
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword });
    expect(reset.status).toBe(200);

    const again = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Another2027Pass' });
    expect(again.body.error.code).toBe('INVALID_RESET_TOKEN');

    expect((await login(email)).status).toBe(401);
    expect((await login(email, newPassword)).status).toBe(200);
    expect((await refresh(oldCookie)).status).toBe(401);
  });

  it('enforces the password policy', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(43), password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'password' });
  });

  it('change-password requires the current password and returns a fresh session', async () => {
    const { email } = await createUser();
    const loginRes = await login(email);
    const auth = { Authorization: `Bearer ${loginRes.body.data.accessToken}` };

    const bad = await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: 'wrong-one-123', newPassword: 'NewPassword2026' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('currentPassword');

    const ok = await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassword2026' });
    expect(ok.status).toBe(200);
    expect(refreshCookie(ok)).toBeDefined();
    // the old access token is dead, the new one works
    expect((await request(app).get('/api/v1/auth/me').set(auth)).status).toBe(401);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ok.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect((await refresh(refreshCookie(loginRes))).status).toBe(401);
  });
});

describe('2FA hook', () => {
  const sent: string[] = [];
  const fakeTotp: TwoFactorProvider = {
    method: 'totp',
    sendChallenge: async (u) => void sent.push(u.id),
    verify: async (_u, code) => code === '123456',
  };
  const { app: app2fa } = buildTestApp({ deps: { twoFactor: { totp: fakeTotp } } });

  it('login returns a challenge; the session is issued only after a valid code', async () => {
    const { user, email } = await createUser();
    await UserModel.updateOne({ _id: user._id }, { twoFactor: { enabled: true, method: 'totp' } });

    const first = await request(app2fa).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(first.body.data).toMatchObject({ twoFactorRequired: true });
    expect(setCookieHeader(first)).toBeUndefined();
    const { challengeToken } = first.body.data as { challengeToken: string };

    // the challenge token is not an access token
    expect(
      (await request(app2fa).get('/api/v1/auth/me').set('Authorization', `Bearer ${challengeToken}`)).status,
    ).toBe(401);

    const bad = await request(app2fa)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, code: '000000' });
    expect(bad.body.error.code).toBe('TWO_FACTOR_INVALID');

    const ok = await request(app2fa).post('/api/v1/auth/2fa/verify').send({ challengeToken, code: '123456' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeDefined();
    expect(refreshCookie(ok)).toBeDefined();
  });

  it('fails closed when 2FA is enabled but no provider is configured', async () => {
    const { user, email } = await createUser();
    await UserModel.updateOne({ _id: user._id }, { twoFactor: { enabled: true, method: 'sms_otp' } });
    const res = await login(email);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TWO_FACTOR_UNAVAILABLE');
  });
});
