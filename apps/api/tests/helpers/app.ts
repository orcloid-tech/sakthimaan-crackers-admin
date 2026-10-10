import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pino } from 'pino';
import request, { type Response } from 'supertest';
import type { Role } from '@sakthimaan/shared';
import { createApp, type AppDeps } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { UserModel } from '../../src/models/index.js';
import { NoopCaptchaVerifier } from '../../src/providers/captcha/captcha.provider.js';
import { ConsoleMailer } from '../../src/providers/mail/mailer.js';
import { LocalStorage } from '../../src/providers/storage/index.js';

/** Per-run temp directory for uploaded files (LocalStorage). */
export const uploadDir = mkdtempSync(path.join(tmpdir(), 'smc-uploads-'));

export const ADMIN_ORIGIN = 'http://admin.test';
export const SHOP_ORIGIN = 'http://shop.test';
export const PASSWORD = 'Diwali2026Sparkle';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    MONGODB_URI: 'mongodb://unused-in-tests/db',
    CORS_ADMIN_ORIGINS: ADMIN_ORIGIN,
    CORS_PUBLIC_ORIGINS: SHOP_ORIGIN,
    ADMIN_APP_URL: ADMIN_ORIGIN,
    JWT_ACCESS_SECRET: 'test-secret-'.padEnd(48, 'x'),
    BCRYPT_COST: '4',
    RATE_LIMIT_AUTH_PER_15MIN: '1000',
    RATE_LIMIT_ADMIN_PER_MIN: '10000',
    RATE_LIMIT_PUBLIC_READ_PER_MIN: '10000',
    ...overrides,
  });
}

export function buildTestApp(opts: { env?: Record<string, string>; deps?: Partial<AppDeps> } = {}) {
  const env = testEnv(opts.env);
  const logger = pino({ level: 'silent' });
  const mailer = new ConsoleMailer(logger);
  const storage = new LocalStorage(uploadDir, 'http://api.test');
  const container = createApp({
    env,
    logger,
    mailer,
    captcha: new NoopCaptchaVerifier(),
    storage,
    ...opts.deps,
  });
  return { ...container, env, mailer, storage };
}

let seq = 0;
export async function createUser(
  opts: { role?: Role; email?: string; isActive?: boolean; password?: string } = {},
) {
  seq += 1;
  const password = opts.password ?? PASSWORD;
  const user = await UserModel.create({
    name: `User ${seq}`,
    email: opts.email ?? `user${seq}.${Date.now()}@example.com`,
    role: opts.role ?? 'super_admin',
    isActive: opts.isActive ?? true,
    passwordHash: await bcrypt.hash(password, 4),
  });
  return { user, email: user.email, password };
}

/** Value of the refresh cookie set by a response, or undefined. */
export function refreshCookie(res: Response, name = 'smc_rt'): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith(`${name}=`));
  if (!cookie) return undefined;
  const value = decodeURIComponent(cookie.slice(name.length + 1).split(';')[0] ?? '');
  return value === '' ? undefined : value;
}

export function setCookieHeader(res: Response, name = 'smc_rt'): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

type App = ReturnType<typeof buildTestApp>['app'];

/** Signs in as a fresh user with the given role; returns an authorised request builder. */
export async function signedIn(app: App, role: Role = 'super_admin') {
  const { user, email, password } = await createUser({ role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const token = (res.body as { data: { accessToken: string } }).data.accessToken;
  const auth = { Authorization: `Bearer ${token}` };
  return {
    user,
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string) => request(app).post(url).set(auth),
    patch: (url: string) => request(app).patch(url).set(auth),
    put: (url: string) => request(app).put(url).set(auth),
    delete: (url: string) => request(app).delete(url).set(auth),
  };
}
