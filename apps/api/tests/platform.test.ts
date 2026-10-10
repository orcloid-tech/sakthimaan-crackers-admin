import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, deploymentWarnings, loadEnv } from '../src/config/env.js';
import { SETTINGS_ID, SettingsModel } from '../src/models/index.js';
import { PASSWORD, buildTestApp, createUser, setCookieHeader, testEnv } from './helpers/app.js';
import { useTestDb } from './helpers/db.js';

useTestDb();

describe('health', () => {
  it('/health is liveness only; /health/ready checks the DB and shutdown state', async () => {
    let shuttingDown = false;
    const { app } = buildTestApp({ deps: { isShuttingDown: () => shuttingDown } });

    const live = await request(app).get('/health');
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: 'ok' });

    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ database: 'up', shuttingDown: false });

    shuttingDown = true;
    const draining = await request(app).get('/health/ready');
    expect(draining.status).toBe(503);
    expect(draining.body.status).toBe('not_ready');
  });
});

describe('env validation', () => {
  const base = {
    MONGODB_URI: 'mongodb://localhost:27017/x',
    ADMIN_APP_URL: 'https://admin.example.com',
    JWT_ACCESS_SECRET: 'z'.repeat(40),
  };

  it('applies safe defaults', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development' });
    expect(env).toMatchObject({ PORT: 4000, BCRYPT_COST: 12, COOKIE_SECURE: false, API_DOCS_ENABLED: true });
  });

  it('fails fast with every problem listed', () => {
    expect(() => loadEnv({ MONGODB_URI: 'postgres://x', JWT_ACCESS_SECRET: 'short' })).toThrow(
      EnvValidationError,
    );
    try {
      loadEnv({ MONGODB_URI: 'postgres://x', JWT_ACCESS_SECRET: 'short' });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/MONGODB_URI/);
      expect(msg).toMatch(/JWT_ACCESS_SECRET/);
      expect(msg).toMatch(/ADMIN_APP_URL/);
    }
  });

  it('enforces production hardening', () => {
    const prod = () =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        BCRYPT_COST: '10',
        COOKIE_SECURE: 'false',
        MAIL_PROVIDER: 'console',
      });
    expect(prod).toThrow(/BCRYPT_COST: Must be >= 12/);
    expect(prod).toThrow(/COOKIE_SECURE/);
    expect(prod).toThrow(/CORS_ADMIN_ORIGINS: Required/);
    expect(prod).toThrow(/MAIL_PROVIDER/);

    const ok = loadEnv({
      ...base,
      NODE_ENV: 'production',
      CORS_ADMIN_ORIGINS: 'https://admin.example.com',
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
    });
    expect(ok).toMatchObject({ COOKIE_SECURE: true, API_DOCS_ENABLED: false, BCRYPT_COST: 12 });
  });

  it('cookie domain: must not be a shared hosting domain and must cover the admin origins', () => {
    expect(() => testEnv({ COOKIE_DOMAIN: 'onrender.com' })).toThrow(/shared hosting domain/);
    expect(() => testEnv({ COOKIE_DOMAIN: 'myshop.vercel.app' })).toThrow(/shared hosting domain/);
    expect(() =>
      testEnv({ COOKIE_DOMAIN: 'example.com', CORS_ADMIN_ORIGINS: 'https://admin.other.com' }),
    ).toThrow(/not under COOKIE_DOMAIN/);
    expect(
      testEnv({ COOKIE_DOMAIN: '.Example.com', CORS_ADMIN_ORIGINS: 'https://admin.example.com' })
        .COOKIE_DOMAIN,
    ).toBe('example.com');
  });

  it('warns when the admin app is on a shared hosting domain', () => {
    expect(
      deploymentWarnings(testEnv({ CORS_ADMIN_ORIGINS: 'https://sakthi-admin.onrender.com' }))[0],
    ).toMatch(/shared hosting domain/);
    expect(deploymentWarnings(testEnv({ CORS_ADMIN_ORIGINS: 'https://admin.sakthimaan.in' }))).toEqual([]);
  });

  it('sets Domain on the refresh cookie only when COOKIE_DOMAIN is configured', async () => {
    const { user, email } = await createUser();
    const send = (app: Parameters<typeof request>[0]) =>
      request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });

    const hostOnly = setCookieHeader(await send(buildTestApp().app));
    expect(hostOnly).not.toMatch(/Domain=/i);

    const scoped = buildTestApp({
      env: {
        COOKIE_DOMAIN: 'sakthimaan.in',
        CORS_ADMIN_ORIGINS: 'https://admin.sakthimaan.in',
        COOKIE_SECURE: 'true',
        COOKIE_SAMESITE: 'lax',
      },
    }).app;
    const cookie = setCookieHeader(await send(scoped));
    expect(cookie).toMatch(/Domain=sakthimaan\.in/i);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(user).toBeDefined();
  });

  it('parses origin lists', () => {
    expect(testEnv({ CORS_PUBLIC_ORIGINS: 'https://a.com, https://www.a.com' }).CORS_PUBLIC_ORIGINS).toEqual([
      'https://a.com',
      'https://www.a.com',
    ]);
    expect(() => testEnv({ CORS_PUBLIC_ORIGINS: 'not a url' })).toThrow(/CORS_PUBLIC_ORIGINS/);
  });
});

describe('OpenAPI docs', () => {
  it('serves a spec generated from the validation schemas', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const login = res.body.paths['/api/v1/auth/login'].post;
    expect(login.requestBody.content['application/json'].schema.required).toEqual(['email', 'password']);
    expect(res.body.paths['/api/v1/auth/me'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(res.body.paths['/api/v1/public/store']).toBeDefined();

    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('is disabled when API_DOCS_ENABLED=false', async () => {
    const { app } = buildTestApp({ env: { API_DOCS_ENABLED: 'false' } });
    expect((await request(app).get('/api/openapi.json')).status).toBe(404);
  });
});

describe('public store endpoint', () => {
  it('returns defaults before setup, then storefront-safe settings only', async () => {
    const { app } = buildTestApp();
    const empty = await request(app).get('/api/v1/public/store');
    expect(empty.body.data).toMatchObject({ configured: false, isOpen: true, orderMode: 'enquiry' });

    await SettingsModel.create({
      _id: SETTINGS_ID,
      company: { name: 'Sakthimaan Crackers', gstin: '33ABCDE1234F1Z5', licenseNumber: 'LE/SVK/2026/123' },
      storefront: { isOpen: false, closedMessage: 'Opening 1 Oct' },
      payment: { upiId: 'sakthimaan@okaxis', upiPayeeName: 'Sakthimaan Crackers' },
    });
    const res = await request(app).get('/api/v1/public/store');
    expect(res.body.data).toMatchObject({
      configured: true,
      name: 'Sakthimaan Crackers',
      licenseNumber: 'LE/SVK/2026/123',
      isOpen: false,
      closedMessage: 'Opening 1 Oct',
      payment: { upiId: 'sakthimaan@okaxis' },
    });
    // internal settings never leak
    expect(res.body.data).not.toHaveProperty('invoice');
    expect(res.body.data).not.toHaveProperty('notifications');
  });
});
