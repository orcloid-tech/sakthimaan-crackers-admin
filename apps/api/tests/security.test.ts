import express from 'express';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireCaptcha } from '../src/middlewares/captcha.js';
import { errorHandler, toAppError } from '../src/middlewares/error-handler.js';
import { mongoSanitize, stripMongoOperators } from '../src/middlewares/sanitize.js';
import { SettingsModel } from '../src/models/index.js';
import type { CaptchaVerifier } from '../src/providers/captcha/captcha.provider.js';
import { ADMIN_ORIGIN, SHOP_ORIGIN, buildTestApp } from './helpers/app.js';
import { useTestDb } from './helpers/db.js';

useTestDb();

const { app } = buildTestApp();

describe('security headers & request id', () => {
  it('sets helmet headers, hides x-powered-by, and returns a request id', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates a well-formed incoming X-Request-Id and replaces a malformed one', async () => {
    const good = await request(app).get('/health').set('X-Request-Id', 'lb-req-12345678');
    expect(good.headers['x-request-id']).toBe('lb-req-12345678');
    const bad = await request(app).get('/health').set('X-Request-Id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });
});

describe('CORS', () => {
  it('admin API: allowlisted admin origin with credentials; others get no CORS headers', async () => {
    const ok = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', ADMIN_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe(ADMIN_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const shopOnAdmin = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', SHOP_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(shopOnAdmin.headers['access-control-allow-origin']).toBeUndefined();

    const evil = await request(app).get('/api/v1/auth/me').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('public API: website origin allowed, no credentials; admin origin not allowed', async () => {
    const shop = await request(app).get('/api/v1/public/store').set('Origin', SHOP_ORIGIN);
    expect(shop.status).toBe(200);
    expect(shop.headers['access-control-allow-origin']).toBe(SHOP_ORIGIN);
    expect(shop.headers['access-control-allow-credentials']).toBeUndefined();

    const admin = await request(app).get('/api/v1/public/store').set('Origin', ADMIN_ORIGIN);
    expect(admin.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('auth endpoints return 429 in the standard envelope with Retry-After', async () => {
    const { app: limited } = buildTestApp({ env: { RATE_LIMIT_AUTH_PER_15MIN: '3' } });
    const attempt = () =>
      request(limited).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    expect(blocked.headers['retry-after']).toBe('900');

    // keyed per IP + email: another account from the same IP is not blocked
    const other = await request(limited).post('/api/v1/auth/login').send({ email: 'c@d.co', password: 'x' });
    expect(other.status).toBe(401);
  });

  it('public reads have their own limiter', async () => {
    const { app: limited } = buildTestApp({ env: { RATE_LIMIT_PUBLIC_READ_PER_MIN: '2' } });
    await request(limited).get('/api/v1/public/store').expect(200);
    await request(limited).get('/api/v1/public/store').expect(200);
    expect((await request(limited).get('/api/v1/public/store')).status).toBe(429);
    // admin API unaffected
    expect((await request(limited).get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('request parsing', () => {
  it('rejects malformed JSON and oversized bodies in the standard envelope', async () => {
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');

    const { app: small } = buildTestApp({ env: { JSON_BODY_LIMIT: '1kb' } });
    const big = await request(small)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('strips Mongo operators and dotted keys recursively', () => {
    expect(
      stripMongoOperators({ email: { $gt: '' }, 'a.b': 1, nested: [{ $where: 'x', ok: 1 }], keep: 'v' }),
    ).toEqual({ email: {}, nested: [{ ok: 1 }], keep: 'v' });
  });

  describe('mongoSanitize middleware (body, params, Express 5 query)', () => {
    function probe(queryParser: 'simple' | 'extended') {
      const app = express();
      app.set('query parser', queryParser);
      app.use(express.json());
      app.use(mongoSanitize);
      app.post('/items/:id', (req, res) => {
        // Read req.query twice: Express 5 recomputes it on each access unless pinned.
        const first: unknown = req.query;
        const second: unknown = req.query;
        res.json({ body: req.body as unknown, params: req.params, query: second, pinned: first === second });
      });
      return app;
    }

    it('cleans nested $-keys and dotted keys in the JSON body at any depth', async () => {
      const res = await request(probe('simple'))
        .post('/items/abc')
        .send({
          name: 'Flower Pot',
          filter: { $where: 'sleep(1000)', price: { $gt: 0 } },
          'profile.role': 'super_admin',
          lines: [{ qty: 1, meta: { $ne: null, 'a.b': 1, ok: true } }],
          deep: { l1: { l2: { l3: { $regex: '.*' } } } },
        });
      expect(res.body.body).toEqual({
        name: 'Flower Pot',
        filter: { price: {} },
        lines: [{ qty: 1, meta: { ok: true } }],
        deep: { l1: { l2: { l3: {} } } },
      });
    });

    it('cleans the query (simple parser: flat keys) and pins the sanitised copy', async () => {
      const res = await request(probe('simple'))
        .post('/items/abc?$where=1&a.b=2&ok=yes&tag=x&tag=y')
        .send({});
      expect(res.body.query).toEqual({ ok: 'yes', tag: ['x', 'y'] });
      expect(res.body.pinned).toBe(true);
    });

    it('cleans nested query objects if the extended parser is ever enabled', async () => {
      const res = await request(probe('extended'))
        .post('/items/abc?price[$gt]=0&filter[name][$regex]=x&filter[ok]=1&a.b=1')
        .send({});
      expect(res.body.query).toEqual({ price: {}, filter: { name: {}, ok: '1' } });
    });

    it('keeps route params (values are validated by Zod per route, e.g. ObjectId format)', async () => {
      const res = await request(probe('simple')).post('/items/%24where').send({});
      expect(res.body.params).toEqual({ id: '$where' }); // a value, not an operator key
    });
  });

  it('returns ROUTE_NOT_FOUND for unknown public routes and 401 for unknown admin routes', async () => {
    const pub = await request(app).get('/api/v1/public/nope');
    expect(pub.status).toBe(404);
    expect(pub.body.error.code).toBe('ROUTE_NOT_FOUND');
    // Admin namespace doesn't reveal which routes exist to unauthenticated callers.
    expect((await request(app).get('/api/v1/nope')).status).toBe(401);
    expect((await request(app).get('/nope')).body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('error mapping', () => {
  it('maps Mongo/Mongoose errors to stable codes without leaking values', () => {
    const dup = Object.assign(new Error('E11000 duplicate key'), {
      name: 'MongoServerError',
      code: 11000,
      keyValue: { email: 'secret@example.com' },
    });
    expect(toAppError(dup)).toMatchObject({ status: 409, code: 'DUPLICATE', details: { fields: ['email'] } });
    expect(JSON.stringify(toAppError(dup)?.details)).not.toContain('secret@example.com');

    const version = new mongoose.Error.VersionError(new SettingsModel() as unknown as mongoose.Document, 1, [
      'x',
    ]);
    expect(toAppError(version)).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });

    const cast = new mongoose.Error.CastError('ObjectId', 'abc', '_id');
    expect(toAppError(cast)).toMatchObject({ status: 400, code: 'INVALID_ID' });

    expect(toAppError(new Error('boom'))).toBeNull();
  });

  it('hides internal error messages in production and includes the request id', async () => {
    const boom = express();
    boom.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    boom.get('/x', () => {
      throw new Error('database password is hunter2');
    });
    boom.use(errorHandler({ exposeInternalErrors: false }));
    const res = await request(boom).get('/x');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(res.body.error.details.requestId).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});

describe('captcha hook', () => {
  it('blocks public writes when the verifier rejects the token', async () => {
    const verifier: CaptchaVerifier = { name: 'fake', verify: async (token) => token === 'good' };
    const site = express();
    site.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    site.post('/enquiry', requireCaptcha(verifier), (_req, res) => void res.json({ ok: true }));
    site.use(errorHandler({ exposeInternalErrors: true }));

    expect((await request(site).post('/enquiry')).body.error.code).toBe('CAPTCHA_FAILED');
    expect((await request(site).post('/enquiry').set('X-Captcha-Token', 'bad')).status).toBe(400);
    expect((await request(site).post('/enquiry').set('X-Captcha-Token', 'good')).status).toBe(200);
  });
});
