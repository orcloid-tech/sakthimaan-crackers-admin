import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ROLES, hasPermission, type Permission, type Role } from '@sakthimaan/shared';
import { authenticate, requireAnyPermission, requirePermission } from '../src/middlewares/auth.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { TokenService } from '../src/services/token.service.js';
import { buildTestApp, createUser } from './helpers/app.js';
import { useTestDb } from './helpers/db.js';

useTestDb();

const { env, services } = buildTestApp();
const tokens = new TokenService(env);

/** A tiny app exercising the real authenticate + permission middleware. */
const probe = express();
probe.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
probe.use(authenticate(tokens));
probe.post(
  '/orders/:id/confirm',
  requirePermission('orders:confirm'),
  (_req, res) => void res.json({ ok: true }),
);
probe.post(
  '/orders/:id/pack-unpaid',
  requirePermission('orders:pack', 'orders:pack_unpaid'),
  (_req, res) => void res.json({ ok: true }),
);
probe.get(
  '/reports',
  requireAnyPermission('reports:read', 'reports:export'),
  (_req, res) => void res.json({ ok: true }),
);
probe.use(errorHandler({ exposeInternalErrors: true }));

async function tokenFor(role: Role) {
  const { user } = await createUser({ role });
  return tokens.signAccess({ userId: String(user._id), role, tokenVersion: user.tokenVersion });
}

describe('requirePermission', () => {
  it.each(ROLES)('enforces orders:confirm for %s exactly as the shared matrix says', async (role) => {
    const res = await request(probe)
      .post('/orders/1/confirm')
      .set('Authorization', `Bearer ${await tokenFor(role)}`);
    const allowed = hasPermission(role, 'orders:confirm');
    expect(res.status).toBe(allowed ? 200 : 403);
    if (!allowed) {
      expect(res.body.error).toMatchObject({ code: 'FORBIDDEN', details: { missing: ['orders:confirm'] } });
    }
  });

  it('requires ALL listed permissions (pack before payment)', async () => {
    const staff = await request(probe)
      .post('/orders/1/pack-unpaid')
      .set('Authorization', `Bearer ${await tokenFor('staff_orders')}`);
    expect(staff.status).toBe(403);
    expect(staff.body.error.details.missing).toEqual(['orders:pack_unpaid']);

    const admin = await request(probe)
      .post('/orders/1/pack-unpaid')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`);
    expect(admin.status).toBe(200);
  });

  it('requireAnyPermission accepts any one of the options', async () => {
    const viewer = await request(probe)
      .get('/reports')
      .set('Authorization', `Bearer ${await tokenFor('viewer')}`);
    expect(viewer.status).toBe(200);
    const inv = await request(probe)
      .get('/reports')
      .set('Authorization', `Bearer ${await tokenFor('staff_inventory')}`);
    expect(inv.status).toBe(403);
  });

  it('uses the role stored in the DB, not the one in the token', async () => {
    const { user } = await createUser({ role: 'viewer' });
    // A token claiming super_admin for a viewer (e.g. issued before a demotion).
    const forged = await tokens.signAccess({
      userId: String(user._id),
      role: 'super_admin',
      tokenVersion: 0,
    });
    const res = await request(probe).post('/orders/1/confirm').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });

  it('rejects expired tokens with TOKEN_EXPIRED', async () => {
    const shortLived = new TokenService({ ...env, JWT_ACCESS_TTL_SECONDS: 1 });
    const { user } = await createUser({ role: 'admin' });
    const token = await shortLived.signAccess({ userId: String(user._id), role: 'admin', tokenVersion: 0 });
    await new Promise((r) => setTimeout(r, 2100));
    const res = await request(probe).post('/orders/1/confirm').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('every permission used by the probe exists in the matrix', () => {
    const used: Permission[] = ['orders:confirm', 'orders:pack', 'orders:pack_unpaid', 'reports:read'];
    for (const p of used) expect(ROLES.some((r) => hasPermission(r, p))).toBe(true);
    expect(services.auth).toBeDefined();
  });
});
