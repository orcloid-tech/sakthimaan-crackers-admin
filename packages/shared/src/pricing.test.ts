import { describe, expect, it } from 'vitest';
import { allocateProportionally, computeCouponDiscount, priceOrder, type PricingInput } from './pricing.js';
import { resolveTax } from './tax.js';

const lines: PricingInput['lines'] = [
  { mrp: 19_900, netPrice: 3_500, qty: 3, hsn: '3604', taxRate: 18 },
  { mrp: 50_000, netPrice: 9_000, qty: 1, hsn: '3604', taxRate: 18 },
];
const base = {
  lines,
  chargesHsn: '3604',
  chargesTaxRate: 18,
  sellerStateCode: 'TN',
  buyerStateCode: 'TN',
} as const;

function expectBalanced(r: ReturnType<typeof priceOrder>) {
  expect(r.taxableValue + r.totalTax).toBe(r.grossTotal);
  expect(r.grandTotal % 100).toBe(0);
  expect(r.grossTotal + r.roundOff).toBe(r.grandTotal);
}

describe('priceOrder', () => {
  it('intra-state (TN → TN): CGST + SGST, back-calculated per line', () => {
    const r = priceOrder(base);
    expect(r.subtotal).toBe(19_500);
    expect(r.mrpTotal).toBe(109_700);
    expect(r.productDiscount).toBe(90_200);
    expect(r.isInterState).toBe(false);
    expect(r.igst).toBe(0);
    expect(r.lines[0]).toMatchObject({ taxableValue: 8_898, cgst: 801, sgst: 801 });
    expect(r.lines[1]).toMatchObject({ taxableValue: 7_627, cgst: 687, sgst: 686 });
    expect(r.taxableValue).toBe(16_525);
    expect(r.totalTax).toBe(2_975);
    expect(r.roundOff).toBe(0);
    expectBalanced(r);
  });

  it('inter-state (TN → KA): IGST only', () => {
    const r = priceOrder({ ...base, buyerStateCode: 'KA' });
    expect(r.isInterState).toBe(true);
    expect(r.cgst + r.sgst).toBe(0);
    expect(r.igst).toBe(2_975);
    expectBalanced(r);
  });

  it('allocates the coupon across lines by value before tax', () => {
    const r = priceOrder({ ...base, couponDiscount: 1_000 });
    expect(r.lines.map((l) => l.couponShare)).toEqual([538, 462]);
    expect(r.grossTotal).toBe(18_500);
    expectBalanced(r);
  });

  it('adds a round-off line when the total has paise', () => {
    const one = (netPrice: number) =>
      priceOrder({ ...base, lines: [{ mrp: 19_900, netPrice, qty: 1, hsn: '3604', taxRate: 18 }] });
    expect(one(3_483)).toMatchObject({ grossTotal: 3_483, roundOff: 17, grandTotal: 3_500 });
    expect(one(3_449)).toMatchObject({ roundOff: -49, grandTotal: 3_400 });
    expect(one(3_450)).toMatchObject({ roundOff: 50, grandTotal: 3_500 });
  });

  it('taxes prepaid delivery/packing as part of the composite supply', () => {
    const r = priceOrder({ ...base, deliveryCharge: 11_800 });
    expect(r.charges).toMatchObject({ taxableValue: 10_000, cgst: 900, sgst: 900 });
    expect(r.hsnSummary).toHaveLength(1);
    expect(r.hsnSummary[0]).toMatchObject({ hsn: '3604', taxRate: 18, taxableValue: 26_525 });
    expectBalanced(r);
  });

  it('keeps separate HSN summary rows per rate', () => {
    const r = priceOrder({
      ...base,
      lines: [...lines, { mrp: 1_000, netPrice: 500, qty: 2, hsn: '3604', taxRate: 12 }],
    });
    expect(r.hsnSummary.map((h) => h.taxRate).sort()).toEqual([12, 18]);
    expectBalanced(r);
  });

  it('rejects a coupon larger than the subtotal and bad quantities', () => {
    expect(() => priceOrder({ ...base, couponDiscount: 20_000 })).toThrow(RangeError);
    expect(() => priceOrder({ ...base, lines: [{ ...lines[0]!, qty: 0 }] })).toThrow(RangeError);
  });
});

describe('allocateProportionally', () => {
  it('always sums exactly to the amount', () => {
    for (const amount of [1, 7, 333, 10_000]) {
      const parts = allocateProportionally(amount, [3, 3, 3, 1_000_001]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });
});

describe('computeCouponDiscount', () => {
  it('percent with cap, minimum order, and flat capped at subtotal', () => {
    expect(computeCouponDiscount({ type: 'percent', value: 10 }, 19_500)).toBe(1_950);
    expect(computeCouponDiscount({ type: 'percent', value: 10, maxDiscount: 1_500 }, 19_500)).toBe(1_500);
    expect(computeCouponDiscount({ type: 'percent', value: 10, minOrderValue: 20_000 }, 19_500)).toBe(0);
    expect(computeCouponDiscount({ type: 'flat', value: 50_000 }, 19_500)).toBe(19_500);
  });
});

describe('resolveTax', () => {
  const defaults = { hsn: '3604', taxRate: 18 };
  it('product → category → settings, with 0% as a valid explicit rate', () => {
    expect(resolveTax({}, null, defaults)).toEqual(defaults);
    expect(resolveTax({}, { taxRate: 12 }, defaults)).toEqual({ hsn: '3604', taxRate: 12 });
    expect(resolveTax({ taxRate: 0 }, { taxRate: 12 }, defaults)).toEqual({ hsn: '3604', taxRate: 0 });
    expect(resolveTax({ hsn: '360410' }, { hsn: '3604', taxRate: null }, defaults)).toEqual({
      hsn: '360410',
      taxRate: 18,
    });
  });
});
