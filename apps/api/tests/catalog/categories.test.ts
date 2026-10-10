import { readdirSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CategoryTreeNode } from '@sakthimaan/shared';
import { AuditLogModel } from '../../src/models/index.js';
import { buildTestApp, signedIn, uploadDir } from '../helpers/app.js';
import { useTestDb } from '../helpers/db.js';
import { makeCategory, makeProduct, pngBuffer } from './fixtures.js';

useTestDb();
const { app } = buildTestApp();
let admin: Awaited<ReturnType<typeof signedIn>>;

beforeAll(async () => {
  admin = await signedIn(app, 'admin');
});

describe('categories', () => {
  it('creates a two-level tree with slugs, tax overrides and product counts', async () => {
    const root = await makeCategory(admin, { name: 'Sparklers Tree', hsn: '3604', taxRate: 12 });
    expect(root).toMatchObject({ slug: 'sparklers-tree', parentId: null, hsn: '3604', taxRate: 12 });
    const sub = await makeCategory(admin, { name: '7cm Electric', parentId: root.id });
    await makeProduct(admin, root.id, { subCategoryId: sub.id });

    const res = await admin.get('/api/v1/categories');
    const node = (res.body.data as CategoryTreeNode[]).find((c) => c.id === root.id);
    expect(node?.children.map((c) => c.id)).toEqual([sub.id]);
    expect(node?.productCount).toBe(1);
    expect(node?.children[0]?.productCount).toBe(1);

    // two levels only
    const deep = await admin.post('/api/v1/categories').send({ name: 'Too deep', parentId: sub.id });
    expect(deep.status).toBe(400);

    // duplicate slug
    const dup = await admin.post('/api/v1/categories').send({ name: 'Xy', slug: 'sparklers-tree' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
  });

  it('auto-numbers duplicate names into unique slugs', async () => {
    const a = await makeCategory(admin, { name: 'Bombs Same' });
    const b = await makeCategory(admin, { name: 'Bombs Same' });
    expect(a.slug).toBe('bombs-same');
    expect(b.slug).toBe('bombs-same-2');
  });

  it('updates with an audited diff and refuses to make a parent with children a child', async () => {
    const root = await makeCategory(admin, { name: 'Rockets Upd' });
    const other = await makeCategory(admin, { name: 'Other Root' });
    await makeCategory(admin, { name: 'Lunik', parentId: root.id });

    const res = await admin.patch(`/api/v1/categories/${root.id}`).send({ taxRate: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.taxRate).toBe(5);
    const log = await AuditLogModel.findOne({
      entity: 'category',
      entityId: root.id,
      action: 'update',
    }).lean();
    expect(log?.changes).toEqual([{ path: 'taxRate', from: null, to: 5 }]);
    expect(log?.summary).toMatch(/inherit/);

    const move = await admin.patch(`/api/v1/categories/${root.id}`).send({ parentId: other.id });
    expect(move.status).toBe(409);
  });

  it('blocks deleting a category that still has products; deletes empty ones (soft)', async () => {
    const cat = await makeCategory(admin);
    const product = await makeProduct(admin, cat.id);
    const blocked = await admin.delete(`/api/v1/categories/${cat.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toEqual({ products: 1, subCategories: 0 });

    await admin.delete(`/api/v1/products/${product.id}`).expect(204);
    await admin.delete(`/api/v1/categories/${cat.id}`).expect(204);
    expect((await admin.get(`/api/v1/categories/${cat.id}`)).status).toBe(404);
  });

  it('reorders', async () => {
    const a = await makeCategory(admin);
    const b = await makeCategory(admin);
    await admin
      .patch('/api/v1/categories/reorder')
      .send({
        items: [
          { id: a.id, sortOrder: 2 },
          { id: b.id, sortOrder: 1 },
        ],
      })
      .expect(204);
    const tree = (await admin.get('/api/v1/categories')).body.data as CategoryTreeNode[];
    const ids = tree.map((c) => c.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it('uploads a sanitised image, served from /uploads with cross-origin access', async () => {
    const cat = await makeCategory(admin);
    const res = await admin
      .post(`/api/v1/categories/${cat.id}/image`)
      .attach('files', await pngBuffer(), 'photo.png');
    expect(res.status).toBe(200);
    const image = res.body.data.image as { url: string; key: string; provider: string };
    expect(image.provider).toBe('local');
    expect(image.key).toMatch(/^categories\/[a-f0-9-]{36}\.webp$/);
    expect(readdirSync(path.join(uploadDir, 'categories'))).toContain(path.basename(image.key));

    const served = await request(app).get(new URL(image.url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('enforces permissions: staff_orders can read but not manage', async () => {
    const staff = await signedIn(app, 'staff_orders');
    expect((await staff.get('/api/v1/categories')).status).toBe(200);
    const res = await staff.post('/api/v1/categories').send({ name: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.details.missing).toEqual(['categories:manage']);
  });
});
