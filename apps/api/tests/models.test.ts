import mongoose, { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_FORMAT,
  counterKey,
  financialYearOf,
  formatDocumentNumber,
  priceOrder,
  resolveTax,
} from '@sakthimaan/shared';
import {
  CategoryModel,
  CounterModel,
  CreditNoteModel,
  CustomerModel,
  InvoiceModel,
  OrderModel,
  ProductModel,
  pricingContext,
} from '../src/models/index.js';
import { useTestDb } from './helpers/db.js';

useTestDb();

const actor = { name: 'Test Admin', role: 'super_admin' };
const address = { line1: '1 Main Rd', city: 'Sivakasi', stateCode: 'TN', pincode: '626123' } as const;

async function makeCategory(overrides: Record<string, unknown> = {}) {
  return CategoryModel.create({
    name: 'Sparklers',
    slug: `sparklers-${new Types.ObjectId().toHexString()}`,
    ...overrides,
  });
}

async function makeProduct(categoryId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return ProductModel.create({
    name: '7cm Electric Sparkler',
    slug: `p-${new Types.ObjectId().toHexString()}`,
    sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
    category: categoryId,
    mrp: 19_900,
    discountPct: 82.5,
    unit: 'box',
    contentsCount: 10,
    ...overrides,
  });
}

describe('indexes', () => {
  it('every model builds its indexes', async () => {
    for (const m of Object.values(mongoose.models)) {
      await expect(m.syncIndexes()).resolves.toBeDefined();
    }
    expect(Object.keys(mongoose.models)).toEqual(expect.arrayContaining(['Invoice', 'CreditNote']));
  });
});

describe('Product', () => {
  it('computes netPrice with the configured rounding mode (₹199 at 82.5%)', async () => {
    const cat = await makeCategory();
    const p = await makeProduct(cat._id);
    expect(p.netPrice).toBe(3_500); // default nearest_rupee

    pricingContext.setRoundingMode('nearest_paisa');
    try {
      p.mrp = 19_901; // force re-validation
      p.mrp = 19_900;
      p.markModified('mrp');
      await p.save();
      expect(p.netPrice).toBe(3_483);
    } finally {
      pricingContext.setRoundingMode('nearest_rupee');
    }
  });

  it('tax fields default to null (inherit) and resolve product → category → settings', async () => {
    const cat = await makeCategory({ taxRate: 12 });
    const p = await makeProduct(cat._id);
    expect(p.hsn).toBeNull();
    expect(p.taxRate).toBeNull();
    expect(resolveTax(p, cat, { hsn: '3604', taxRate: 18 })).toEqual({ hsn: '3604', taxRate: 12 });
  });

  it('rejects stockMode "components" (reserved) and invalid discounts as validation errors', async () => {
    const cat = await makeCategory();
    await expect(makeProduct(cat._id, { stockMode: 'components' })).rejects.toThrow(/not supported yet/);
    await expect(makeProduct(cat._id, { discountPct: 82.555 })).rejects.toThrow(
      mongoose.Error.ValidationError,
    );
  });

  it('soft-deleted SKUs are hidden and can be reused', async () => {
    const cat = await makeCategory();
    const p = await makeProduct(cat._id, { sku: 'REUSE-1' });
    await ProductModel.updateOne({ _id: p._id }, { isDeleted: true, deletedAt: new Date() });
    expect(await ProductModel.countDocuments({ sku: 'REUSE-1' })).toBe(0);
    expect(await ProductModel.countDocuments({ sku: 'REUSE-1' }, { withDeleted: true })).toBe(1);
    await expect(makeProduct(cat._id, { sku: 'reuse-1' })).resolves.toMatchObject({ sku: 'REUSE-1' });
  });
});

describe('Order line snapshots', () => {
  it('are unaffected when the product is edited, deleted, or its SKU reused', async () => {
    const cat = await makeCategory();
    const product = await makeProduct(cat._id, { sku: 'SNAP-1' });
    const customer = await CustomerModel.create({ name: 'Ravi', phone: '9876543210' });
    const tax = resolveTax(product, cat, { hsn: '3604', taxRate: 18 });
    const pricing = priceOrder({
      lines: [{ mrp: product.mrp, netPrice: product.netPrice, qty: 2, ...tax }],
      chargesHsn: '3604',
      chargesTaxRate: 18,
      sellerStateCode: 'TN',
      buyerStateCode: 'TN',
    });
    const line = pricing.lines[0]!;
    const order = await OrderModel.create({
      orderNo: 'ORD/26-27/000001',
      mode: 'enquiry',
      source: 'admin',
      customer: customer._id,
      customerSnapshot: { name: customer.name, phone: customer.phone },
      shippingAddress: address,
      items: [
        {
          product: product._id,
          sku: product.sku,
          name: product.name,
          type: product.type,
          categoryId: cat._id,
          categoryName: cat.name,
          unit: product.unit,
          hsn: tax.hsn,
          taxRate: tax.taxRate,
          mrp: product.mrp,
          discountPct: product.discountPct,
          netPrice: product.netPrice,
          qty: 2,
          ...line,
        },
      ],
      pricing: { ...pricing, sellerStateCode: 'TN', placeOfSupply: 'TN', netPriceRounding: 'nearest_rupee' },
    });

    // Edit, delete, and reuse the SKU.
    await ProductModel.updateOne({ _id: product._id }, { name: 'Renamed', mrp: 99_900 });
    await ProductModel.updateOne({ _id: product._id }, { isDeleted: true });
    await makeProduct(cat._id, { sku: 'SNAP-1', name: 'Different product', mrp: 5_000 });

    const reloaded = await OrderModel.findById(order._id).lean();
    expect(reloaded?.items[0]).toMatchObject({
      sku: 'SNAP-1',
      name: '7cm Electric Sparkler',
      mrp: 19_900,
      discountPct: 82.5,
      netPrice: 3_500,
      hsn: '3604',
      taxRate: 18,
      unit: 'box',
      lineTotal: 7_000,
    });
    const totals = reloaded?.pricing;
    expect(totals?.grandTotal).toBe(7_000);
    expect((totals?.taxableValue ?? 0) + (totals?.totalTax ?? 0)).toBe(7_000);
  });
});

describe('Invoice / CreditNote immutability', () => {
  const fy = financialYearOf(new Date('2026-10-10T12:00:00+05:30'));
  const party = {
    seller: { name: 'Sakthimaan Crackers', stateCode: 'TN', gstStateCode: '33' },
    buyer: { name: 'Ravi', phone: '9876543210', address },
  } as const;
  const totals = {
    mrpTotal: 39_800,
    productDiscount: 32_800,
    subtotal: 7_000,
    couponDiscount: 0,
    deliveryCharge: 0,
    packingCharge: 0,
    taxableValue: 5_932,
    cgst: 534,
    sgst: 534,
    igst: 0,
    totalTax: 1_068,
    grossTotal: 7_000,
    roundOff: 0,
    grandTotal: 7_000,
    amountInWords: 'Rupees Seventy Only',
  };
  const docBase = () => ({
    financialYear: fy.short,
    issuedAt: new Date(),
    order: new Types.ObjectId(),
    orderNo: 'ORD/26-27/000001',
    ...party,
    placeOfSupply: 'TN' as const,
    isInterState: false,
    items: [],
    hsnSummary: [],
    totals,
    issuedBy: actor,
  });

  it('invoice number fits GST 16-char limit and cannot be edited, updated or deleted', async () => {
    const number = formatDocumentNumber(DEFAULT_INVOICE_FORMAT, { prefix: 'SMC', fy, seq: 42 });
    expect(number).toBe('SMC/26-27/00042');
    const inv = await InvoiceModel.create({ ...docBase(), number, seq: 42 });

    inv.number = 'SMC/26-27/00043';
    await expect(inv.save()).rejects.toThrow(/Immutable document: cannot modify number/);

    await expect(InvoiceModel.updateOne({ _id: inv._id }, { number: 'X' })).rejects.toThrow(/not allowed/);
    await expect(InvoiceModel.deleteOne({ _id: inv._id })).rejects.toThrow(/not allowed/);
    await expect(InvoiceModel.findOneAndDelete({ _id: inv._id })).rejects.toThrow(/not allowed/);

    // The only permitted change: cancellation via a credit note.
    const fresh = await InvoiceModel.findById(inv._id).orFail();
    fresh.status = 'cancelled';
    fresh.set('cancelledBy', {
      creditNote: new Types.ObjectId(),
      number: 'CN/26-27/00001',
      at: new Date(),
    });
    await expect(fresh.save()).resolves.toBeDefined();
  });

  it('invoice numbers are unique forever (no reuse) and one invoice per order', async () => {
    const order = new Types.ObjectId();
    await InvoiceModel.create({ ...docBase(), order, number: 'SMC/26-27/00100', seq: 100 });
    await expect(InvoiceModel.create({ ...docBase(), number: 'SMC/26-27/00100', seq: 101 })).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      InvoiceModel.create({ ...docBase(), order, number: 'SMC/26-27/00102', seq: 102 }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('credit notes are fully immutable', async () => {
    const cn = await CreditNoteModel.create({
      ...docBase(),
      number: 'CN/26-27/00001',
      seq: 1,
      invoice: new Types.ObjectId(),
      invoiceNumber: 'SMC/26-27/00042',
      invoiceDate: new Date(),
      reasonCode: 'order_cancelled',
    });
    cn.reason = 'changed my mind';
    await expect(cn.save()).rejects.toThrow(/Immutable/);
    await expect(CreditNoteModel.deleteMany({})).rejects.toThrow(/not allowed/);
  });
});

describe('Counter (gap-free numbering)', () => {
  it('an aborted transaction does not consume a number', async () => {
    const key = counterKey('invoice', financialYearOf(new Date()));
    const next = (session: mongoose.ClientSession) =>
      CounterModel.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after', session },
      );

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await next(session);
      });
      await expect(
        session.withTransaction(async () => {
          await next(session);
          throw new Error('invoice creation failed');
        }),
      ).rejects.toThrow('invoice creation failed');
      await session.withTransaction(async () => {
        await next(session);
      });
    } finally {
      await session.endSession();
    }
    expect((await CounterModel.findById(key).lean())?.seq).toBe(2);
  });
});
