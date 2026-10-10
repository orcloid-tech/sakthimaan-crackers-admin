import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DemandRow, ProductDto, StockMovementDto } from '@sakthimaan/shared';
import {
  AuditLogModel,
  CustomerModel,
  OrderModel,
  ProductModel,
  StockBatchModel,
  StockMovementModel,
} from '../../src/models/index.js';
import { buildTestApp, signedIn } from '../helpers/app.js';
import { useTestDb } from '../helpers/db.js';
import { makeCategory, makeProduct } from './fixtures.js';

useTestDb();
const { app } = buildTestApp();
let staff: Awaited<ReturnType<typeof signedIn>>;
let catId: string;

beforeAll(async () => {
  staff = await signedIn(app, 'staff_inventory');
  catId = (await makeCategory(await signedIn(app, 'admin'))).id;
});

const move = (body: Record<string, unknown>) => staff.post('/api/v1/inventory/movements').send(body);

async function ledgerOf(productId: string) {
  return StockMovementModel.find({ product: productId }).sort({ createdAt: 1, _id: 1 }).lean();
}

function expectChained(
  rows: { balanceBefore: number; balanceAfter: number; qty: number }[],
  finalStock: number,
) {
  let prev: number | null = null;
  for (const r of rows) {
    if (prev !== null) expect(r.balanceBefore).toBe(prev);
    expect(r.balanceAfter).toBe(r.balanceBefore + r.qty);
    prev = r.balanceAfter;
  }
  expect(prev).toBe(finalStock);
}

describe('stock movements', () => {
  it('stock in, stock out and adjustment keep stock and the ledger in step (audited)', async () => {
    const p = await makeProduct(staff, catId);
    expect((await move({ type: 'stock_in', productId: p.id, qty: 50 })).body.data).toMatchObject({
      stockBefore: 0,
      stockAfter: 50,
    });
    expect(
      (await move({ type: 'stock_out', productId: p.id, qty: 5, reason: 'Damaged in godown' })).body.data
        .stockAfter,
    ).toBe(45);

    const current = (await staff.get(`/api/v1/products/${p.id}`)).body.data as ProductDto;
    const adj = await move({
      type: 'adjustment',
      productId: p.id,
      newStock: 40,
      expectedStockVersion: current.stockVersion,
      reason: 'Physical count',
    });
    expect(adj.body.data).toMatchObject({ stockBefore: 45, stockAfter: 40 });

    const rows = await ledgerOf(p.id);
    expect(rows.map((r) => [r.type, r.qty])).toEqual([
      ['stock_in', 50],
      ['stock_out', -5],
      ['adjustment', -5],
    ]);
    expectChained(rows, 40);
    expect(rows.every((r) => r.actor.name.startsWith('User'))).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'stock_change', entityId: p.id })).toBe(3);

    const ledger = await staff.get(`/api/v1/products/${p.id}/stock-ledger?limit=2`);
    expect(ledger.body.data.product).toMatchObject({ stock: 40 });
    expect((ledger.body.data.movements as StockMovementDto[]).map((m) => m.type)).toEqual([
      'adjustment',
      'stock_out',
    ]);
    const page2 = await staff.get(
      `/api/v1/products/${p.id}/stock-ledger?limit=2&cursor=${ledger.body.meta.nextCursor}`,
    );
    expect((page2.body.data.movements as StockMovementDto[]).map((m) => m.type)).toEqual(['stock_in']);
    expect(page2.body.meta.nextCursor).toBeNull();
  });

  it('never goes below zero and reports the shortage', async () => {
    const p = await makeProduct(staff, catId, { openingStock: 3 });
    const res = await move({ type: 'stock_out', productId: p.id, qty: 5, reason: 'Sample' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { items: [{ sku: p.sku, requested: 5, available: 3, shortBy: 2 }] },
    });
    expect((await ProductModel.findById(p.id).lean())?.stock).toBe(3);
  });

  it('concurrent stock-outs: exactly as many succeed as the stock allows', async () => {
    const p = await makeProduct(staff, catId, { openingStock: 10 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        move({ type: 'stock_out', productId: p.id, qty: 3, reason: 'Parallel test' }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const short = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(3);
    expect(short).toBe(3);
    expect((await ProductModel.findById(p.id).lean())?.stock).toBe(1);
    expectChained(await ledgerOf(p.id), 1);
  });

  it('adjustment with a stale stockVersion is rejected with the current values', async () => {
    const p = await makeProduct(staff, catId, { openingStock: 20 });
    await move({ type: 'stock_in', productId: p.id, qty: 5 }); // version moves on
    const res = await move({
      type: 'adjustment',
      productId: p.id,
      newStock: 18,
      expectedStockVersion: 1,
      reason: 'Count',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentStock: 25, currentStockVersion: 2 },
    });
  });

  it('validates input and permissions', async () => {
    const p = await makeProduct(staff, catId);
    const noReason = await move({ type: 'stock_out', productId: p.id, qty: 1 });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].path).toBe('reason');

    const viewer = await signedIn(app, 'viewer');
    expect(
      (await viewer.post('/api/v1/inventory/movements').send({ type: 'stock_in', productId: p.id, qty: 1 }))
        .status,
    ).toBe(403);
    expect((await viewer.get('/api/v1/inventory/movements')).status).toBe(200);
  });
});

describe('batches (optional lot tracking)', () => {
  it('requires a lot on stock-in and consumes oldest batches first', async () => {
    const p = await makeProduct(staff, catId, { trackBatches: true });
    const noLot = await move({ type: 'stock_in', productId: p.id, qty: 5 });
    expect(noLot.status).toBe(400);

    await move({
      type: 'stock_in',
      productId: p.id,
      qty: 5,
      lotNumber: 'lot-a',
      supplier: 'Sivakasi Unit 1',
    }).expect(201);
    await new Promise((r) => setTimeout(r, 5));
    await move({ type: 'stock_in', productId: p.id, qty: 10, lotNumber: 'LOT-B' }).expect(201);

    const out = await move({ type: 'stock_out', productId: p.id, qty: 7, reason: 'Sample pack' });
    expect(out.status).toBe(201);
    const batches = (await staff.get(`/api/v1/inventory/batches?productId=${p.id}`)).body.data as {
      lotNumber: string;
      qtyRemaining: number;
    }[];
    expect(batches.map((b) => [b.lotNumber, b.qtyRemaining])).toEqual([
      ['LOT-A', 0],
      ['LOT-B', 8],
    ]);
    // two ledger rows (one per batch), still chained
    const rows = await ledgerOf(p.id);
    expect(rows.slice(-2).map((r) => r.qty)).toEqual([-5, -2]);
    expectChained(rows, 8);
  });

  it('enabling batch tracking on existing stock opens an OPENING batch', async () => {
    const p = await makeProduct(staff, catId, { openingStock: 12 });
    await staff.patch(`/api/v1/products/${p.id}`).send({ version: 0, trackBatches: true }).expect(200);
    const batch = await StockBatchModel.findOne({ product: p.id }).lean();
    expect(batch).toMatchObject({ lotNumber: 'OPENING', qtyRemaining: 12 });
    await move({ type: 'stock_out', productId: p.id, qty: 2, reason: 'Sample' }).expect(201);
  });
});

describe('alerts and demand', () => {
  it('lists low-stock products', async () => {
    // Created by an admin: products created by inventory staff are drafts (inactive) until approved.
    const admin = await signedIn(app, 'admin');
    const low = await makeProduct(admin, catId, { openingStock: 2, lowStockThreshold: 5 });
    await makeProduct(admin, catId, { openingStock: 50, lowStockThreshold: 5 });
    const res = await staff.get(`/api/v1/inventory/low-stock?categoryId=${catId}&pageSize=100`);
    const ids = (res.body.data as ProductDto[]).map((p) => p.id);
    expect(ids).toContain(low.id);
    expect((res.body.data as ProductDto[]).every((p) => p.isLowStock)).toBe(true);
  });

  it('shows pending enquiry demand per product (enquiries hold no stock)', async () => {
    const p = await makeProduct(staff, catId, { openingStock: 4 });
    const customer = await CustomerModel.create({ name: 'Ravi', phone: '9876543210' });
    const enquiry = (qty: number, status: 'enquiry' | 'confirmed' = 'enquiry') => ({
      orderNo: `ORD/26-27/${new Types.ObjectId().toHexString().slice(-6)}`,
      status,
      mode: 'enquiry' as const,
      source: 'storefront' as const,
      customer: customer._id,
      customerSnapshot: { name: 'Ravi', phone: '9876543210' },
      shippingAddress: { line1: 'x', city: 'Madurai', stateCode: 'TN' as const, pincode: '625001' },
      items: [
        {
          product: new Types.ObjectId(p.id),
          sku: p.sku,
          name: p.name,
          type: 'single' as const,
          categoryId: new Types.ObjectId(catId),
          categoryName: 'c',
          unit: 'box' as const,
          hsn: '3604',
          taxRate: 18,
          mrp: p.mrp,
          discountPct: p.discountPct,
          netPrice: p.netPrice,
          qty,
          lineMrpTotal: p.mrp * qty,
          lineTotal: p.netPrice * qty,
          taxableValue: 0,
        },
      ],
      pricing: {
        mrpTotal: 0,
        productDiscount: 0,
        subtotal: 0,
        taxableValue: 0,
        totalTax: 0,
        grossTotal: 0,
        grandTotal: 0,
        isInterState: false,
        sellerStateCode: 'TN' as const,
        placeOfSupply: 'TN' as const,
      },
    });
    await OrderModel.create([enquiry(3), enquiry(4), enquiry(9, 'confirmed')]);

    const product = (await staff.get(`/api/v1/products/${p.id}`)).body.data as ProductDto;
    expect(product.pendingDemand).toBe(7); // the confirmed order is already deducted, not "pending"

    const demand = (await staff.get('/api/v1/inventory/demand?onlyShort=true')).body.data as DemandRow[];
    expect(demand.find((d) => d.productId === p.id)).toMatchObject({
      pendingDemand: 7,
      stock: 4,
      shortBy: 3,
      enquiryCount: 2,
    });
  });
});
