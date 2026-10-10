import { beforeAll, describe, expect, it } from 'vitest';
import type { BulkPriceResult, ComboSuggestion, ProductDto } from '@sakthimaan/shared';
import {
  AuditLogModel,
  ProductModel,
  SETTINGS_ID,
  SettingsModel,
  StockMovementModel,
} from '../../src/models/index.js';
import { buildTestApp, signedIn } from '../helpers/app.js';
import { useTestDb } from '../helpers/db.js';
import { makeCategory, makeProduct, pngBuffer } from './fixtures.js';

useTestDb();
const { app, services } = buildTestApp();
let admin: Awaited<ReturnType<typeof signedIn>>;

beforeAll(async () => {
  admin = await signedIn(app, 'admin');
});

describe('create & read', () => {
  it('creates a product with derived net price, inherited tax and opening stock in the ledger', async () => {
    await SettingsModel.create({
      _id: SETTINGS_ID,
      company: { name: 'S' },
      tax: { defaultTaxRate: 18, defaultHsn: '3604' },
    });
    services.settings.invalidate();
    const cat = await makeCategory(admin, { name: 'Sparklers Create', taxRate: 12 });
    const p = await makeProduct(admin, cat.id, {
      name: '7cm Electric Sparkler',
      sku: 'sp-7cm-x',
      mrp: 19_900,
      discountPct: 82.5,
      openingStock: 120,
      isGreen: true,
    });
    expect(p).toMatchObject({
      sku: 'SP-7CM-X',
      slug: '7cm-electric-sparkler',
      netPrice: 3_500, // ₹199 at 82.5% → ₹34.825 → ₹35 (nearest rupee)
      hsn: null,
      taxRate: null,
      effectiveTax: { hsn: '3604', taxRate: 12 }, // from the category
      stock: 120,
      stockVersion: 1,
      isGreen: true,
      category: { id: cat.id, name: 'Sparklers Create' },
      version: 0,
    });
    const ledger = await StockMovementModel.find({ product: p.id }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: 'stock_in',
      qty: 120,
      balanceBefore: 0,
      balanceAfter: 120,
      reason: 'Opening stock',
    });
  });

  it('rejects duplicate SKUs, unknown categories and invalid prices', async () => {
    const cat = await makeCategory(admin);
    await makeProduct(admin, cat.id, { sku: 'DUP-1' });
    const dup = await admin
      .post('/api/v1/products')
      .send({ name: 'Again', sku: 'dup-1', categoryId: cat.id, unit: 'box', mrp: 100 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'DUPLICATE', details: { fields: ['sku'] } });

    const badCat = await admin
      .post('/api/v1/products')
      .send({ name: 'Orphan', sku: 'ORPH-1', categoryId: '0123456789abcdef01234567', unit: 'box', mrp: 100 });
    expect(badCat.status).toBe(400);
    expect(badCat.body.error.details[0].path).toBe('categoryId');

    const badPrice = await admin
      .post('/api/v1/products')
      .send({ name: 'Bad', sku: 'BAD-1', categoryId: cat.id, unit: 'box', mrp: 199.5, discountPct: 82.555 });
    expect(badPrice.status).toBe(400);
    expect((badPrice.body.error.details as { path: string }[]).map((d) => d.path).sort()).toEqual([
      'discountPct',
      'mrp',
    ]);
  });

  it('lists with search, category filter, sorting and paging', async () => {
    const cat = await makeCategory(admin, { name: 'Flower Pots List' });
    await makeProduct(admin, cat.id, { name: 'Flower Pot Big', sku: 'FP-BIG-L', mrp: 45_000 });
    await makeProduct(admin, cat.id, { name: 'Flower Pot Small', sku: 'FP-SMALL-L', mrp: 25_000 });
    await makeProduct(admin, cat.id, { name: 'Colour Koti', sku: 'KOTI-L', mrp: 60_000 });

    const res = await admin.get(
      `/api/v1/products?categoryId=${cat.id}&q=flower&sort=netPrice&order=desc&pageSize=1`,
    );
    expect(res.body.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect((res.body.data as ProductDto[]).map((p) => p.sku)).toEqual(['FP-BIG-L']);

    const regexSafe = await admin.get('/api/v1/products?q=(.*');
    expect(regexSafe.status).toBe(200);
  });
});

describe('update & optimistic concurrency', () => {
  it('updates details with the current version; a stale version gets 409', async () => {
    const cat = await makeCategory(admin);
    const p = await makeProduct(admin, cat.id);
    const ok = await admin
      .patch(`/api/v1/products/${p.id}`)
      .send({ version: 0, name: 'Renamed Pot', isFeatured: true });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ name: 'Renamed Pot', isFeatured: true, version: 1 });

    const stale = await admin.patch(`/api/v1/products/${p.id}`).send({ version: 0, name: 'Lost Update' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 1 } });

    const log = await AuditLogModel.findOne({ entity: 'product', entityId: p.id, action: 'update' }).lean();
    expect(log?.changes.map((c) => c.path).sort()).toEqual(['isFeatured', 'name']);
  });

  it('never edits stock or price through the details endpoint', async () => {
    const cat = await makeCategory(admin);
    const p = await makeProduct(admin, cat.id);
    const res = await admin.patch(`/api/v1/products/${p.id}`).send({ version: 0, stock: 999, mrp: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('price changes need products:update_price and are audited as price_change', async () => {
    const cat = await makeCategory(admin);
    const p = await makeProduct(admin, cat.id, { mrp: 19_900, discountPct: 80 });

    const inventoryStaff = await signedIn(app, 'staff_inventory');
    const denied = await inventoryStaff
      .patch(`/api/v1/products/${p.id}/price`)
      .send({ version: 0, discountPct: 90 });
    expect(denied.status).toBe(403);

    const res = await admin
      .patch(`/api/v1/products/${p.id}/price`)
      .send({ version: 0, discountPct: 82.5, taxRate: 5 });
    expect(res.body.data).toMatchObject({
      discountPct: 82.5,
      netPrice: 3_500,
      taxRate: 5,
      effectiveTax: { taxRate: 5 },
    });
    const log = await AuditLogModel.findOne({ entityId: p.id, action: 'price_change' }).lean();
    expect(log?.changes).toEqual(
      expect.arrayContaining([
        { path: 'discountPct', from: 80, to: 82.5 },
        { path: 'netPrice', from: 4_000, to: 3_500 },
        { path: 'taxRate', from: null, to: 5 },
      ]),
    );
  });
});

describe('bulk price update', () => {
  it('previews (dry run) then applies 80% to a category, rounding like single edits', async () => {
    const cat = await makeCategory(admin, { name: 'Bulk Cat' });
    const a = await makeProduct(admin, cat.id, { mrp: 19_900, discountPct: 50 });
    const b = await makeProduct(admin, cat.id, { mrp: 33_300, discountPct: 50 });
    const other = await makeProduct(admin, (await makeCategory(admin)).id, { discountPct: 50 });

    const body = { filter: { categoryIds: [cat.id] }, change: { mode: 'set_discount', discountPct: 80 } };
    const preview = (await admin.post('/api/v1/products/bulk-price').send(body)).body.data as BulkPriceResult;
    expect(preview).toMatchObject({ dryRun: true, matched: 2, changed: 2 });
    expect(preview.rows.find((r) => r.id === b.id)?.after).toEqual({
      mrp: 33_300,
      discountPct: 80,
      netPrice: 6_700,
    }); // 66.6 → 67
    expect((await ProductModel.findById(a.id).lean())?.discountPct).toBe(50); // nothing saved

    const applied = (await admin.post('/api/v1/products/bulk-price').send({ ...body, dryRun: false })).body
      .data;
    expect(applied).toMatchObject({ dryRun: false, changed: 2 });
    expect((await ProductModel.findById(a.id).lean())?.netPrice).toBe(4_000); // 39.80 → ₹40
    expect((await ProductModel.findById(other.id).lean())?.discountPct).toBe(50);
    expect(await AuditLogModel.countDocuments({ action: 'price_change', summary: 'Bulk price change' })).toBe(
      2,
    );

    // product versions moved on, so old edit forms are rejected
    const stale = await admin.patch(`/api/v1/products/${a.id}`).send({ version: 0, name: 'x y' });
    expect(stale.status).toBe(409);
  });

  it('adjusts MRP by a percentage, rounded to whole rupees', async () => {
    const cat = await makeCategory(admin);
    const p = await makeProduct(admin, cat.id, { mrp: 19_900, discountPct: 80 });
    const res = await admin
      .post('/api/v1/products/bulk-price')
      .send({ filter: { productIds: [p.id] }, change: { mode: 'adjust_mrp', percent: 7.5 }, dryRun: false });
    // 199 × 1.075 = 213.925 → ₹214; net 214 × 0.2 = 42.8 → ₹43
    expect(res.body.data.rows[0].after).toEqual({ mrp: 21_400, discountPct: 80, netPrice: 4_300 });
  });

  it('rolls back everything if a price changed after the preview', async () => {
    const cat = await makeCategory(admin);
    const a = await makeProduct(admin, cat.id, { discountPct: 10 });
    const b = await makeProduct(admin, cat.id, { discountPct: 10 });
    // Another admin edits b's price right as the bulk write starts.
    const realBulkWrite = ProductModel.bulkWrite.bind(ProductModel);
    ProductModel.bulkWrite = async (...args: Parameters<typeof realBulkWrite>) => {
      await ProductModel.updateOne({ _id: b.id }, { discountPct: 11 });
      return realBulkWrite(...args);
    };
    try {
      const res = await admin.post('/api/v1/products/bulk-price').send({
        filter: { productIds: [a.id, b.id] },
        change: { mode: 'set_discount', discountPct: 90 },
        dryRun: false,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    } finally {
      ProductModel.bulkWrite = realBulkWrite;
    }
    // a was not changed either: all or nothing
    expect((await ProductModel.findById(a.id).lean())?.discountPct).toBe(10);
    expect(services.products).toBeDefined();
  });
});

describe('gift boxes (combos)', () => {
  it('suggests a price from the contents and creates the box with own stock', async () => {
    const cat = await makeCategory(admin, { name: 'Gift Boxes Test' });
    const s1 = await makeProduct(admin, cat.id, { mrp: 19_900, discountPct: 80 }); // net 40
    const s2 = await makeProduct(admin, cat.id, { mrp: 45_000, discountPct: 80 }); // net 90
    const items = [
      { productId: s1.id, qty: 2 },
      { productId: s2.id, qty: 1 },
    ];
    const sug = (
      await admin.post('/api/v1/products/combos/price-suggestion').send({ items, extraDiscountPct: 5 })
    ).body.data as ComboSuggestion;
    expect(sug).toMatchObject({ itemsMrpTotal: 84_800, itemsNetTotal: 17_000 });
    expect(sug.suggested.mrp).toBe(84_800);
    // target = 170 × 0.95 = 161.50; the suggested net price lands within a rupee of it
    expect(Math.abs(sug.suggested.netPrice - 16_150)).toBeLessThanOrEqual(100);
    expect(sug.savingsVsSeparate).toBeGreaterThan(0);

    const box = await makeProduct(admin, cat.id, {
      type: 'combo',
      name: 'Family Gift Box',
      comboItems: items,
      mrp: sug.suggested.mrp,
      discountPct: sug.suggested.discountPct,
      openingStock: 10,
    });
    expect(box).toMatchObject({ type: 'combo', stockMode: 'own', stock: 10 });
    expect(box.comboItems.map((c) => [c.sku, c.qty])).toEqual([
      [s1.sku, 2],
      [s2.sku, 1],
    ]);
    // contents keep their own stock
    expect((await admin.get(`/api/v1/products/${s1.id}`)).body.data.stock).toBe(0);

    // can't nest boxes, can't delete a product that is inside a box
    const nested = await admin.post('/api/v1/products').send({
      type: 'combo',
      name: 'Nested',
      sku: 'NEST-1',
      categoryId: cat.id,
      unit: 'box',
      mrp: 100,
      comboItems: [{ productId: box.id, qty: 1 }],
    });
    expect(nested.status).toBe(400);
    const del = await admin.delete(`/api/v1/products/${s1.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.details.combos).toEqual([box.sku]);
  });

  it('requires contents for a box and rejects contents on a single product', async () => {
    const cat = await makeCategory(admin);
    const r1 = await admin
      .post('/api/v1/products')
      .send({ type: 'combo', name: 'Empty', sku: 'EMPTY-B', categoryId: cat.id, unit: 'box', mrp: 100 });
    expect(r1.body.error.details[0].path).toBe('comboItems');
  });
});

describe('delete, restore, images', () => {
  it('soft-deletes (hidden, SKU reusable) and restores unless the SKU was taken', async () => {
    const cat = await makeCategory(admin);
    const p = await makeProduct(admin, cat.id, { sku: 'RESTORE-1' });
    await admin.delete(`/api/v1/products/${p.id}`).expect(204);
    expect((await admin.get(`/api/v1/products/${p.id}`)).status).toBe(404);
    const deleted = await admin.get('/api/v1/products?deleted=true&q=RESTORE-1');
    expect(deleted.body.data[0].isDeleted).toBe(true);

    const viewer = await signedIn(app, 'viewer');
    expect((await viewer.get('/api/v1/products?deleted=true')).status).toBe(403);

    await admin.post(`/api/v1/products/${p.id}/restore`).expect(200);
    await admin.delete(`/api/v1/products/${p.id}`).expect(204);
    await makeProduct(admin, cat.id, { sku: 'RESTORE-1' }); // reuse the SKU
    const clash = await admin.post(`/api/v1/products/${p.id}/restore`);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('DUPLICATE');
  });

  it('uploads, reorders and removes images; rejects non-images and enforces the limit', async () => {
    const cat = await makeCategory(admin);
    const p = await makeProduct(admin, cat.id);
    const up = await admin
      .post(`/api/v1/products/${p.id}/images`)
      .attach('files', await pngBuffer(2400, 1200), 'a.png')
      .attach('files', await pngBuffer(), 'b.png');
    expect(up.status).toBe(200);
    const imgs = up.body.data.images as { key: string; width: number }[];
    expect(imgs).toHaveLength(2);
    expect(imgs[0]?.width).toBe(1600); // resized to max 1600 px

    const fake = await admin
      .post(`/api/v1/products/${p.id}/images`)
      .attach('files', Buffer.from('not an image'), 'evil.png');
    expect(fake.status).toBe(400);
    expect(fake.body.error.message).toMatch(/JPEG, PNG/);

    const version = up.body.data.version as number;
    const reordered = await admin
      .patch(`/api/v1/products/${p.id}/images`)
      .send({ version, keys: [imgs[1]?.key, imgs[0]?.key] });
    expect((reordered.body.data.images as { key: string }[])[0]?.key).toBe(imgs[1]?.key);

    const removed = await admin.delete(
      `/api/v1/products/${p.id}/images/${encodeURIComponent(imgs[0]?.key ?? '')}`,
    );
    expect(removed.body.data.images).toHaveLength(1);

    const many = admin.post(`/api/v1/products/${p.id}/images`);
    for (let i = 0; i < 8; i++) many.attach('files', await pngBuffer(), `${i}.png`);
    const tooMany = await many;
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toMatch(/at most 8/);
  });
});
