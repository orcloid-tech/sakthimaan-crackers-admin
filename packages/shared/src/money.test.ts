import { describe, expect, it } from 'vitest';
import {
  computeNetPrice,
  divRoundHalfUp,
  percentToBasisPoints,
  roundToRupee,
  splitCgstSgst,
  splitInclusiveGst,
} from './money.js';

describe('computeNetPrice', () => {
  it('₹199 at 82.5% (non-exact) rounds to ₹35 by default and ₹34.83 with nearest_paisa', () => {
    // 199 × 0.175 = 34.825
    expect(computeNetPrice(19_900, 82.5)).toBe(3_500);
    expect(computeNetPrice(19_900, 82.5, 'nearest_rupee')).toBe(3_500);
    expect(computeNetPrice(19_900, 82.5, 'nearest_paisa')).toBe(3_483);
  });

  it('is immune to float artefacts (100 − 82.3 = 17.700000000000003)', () => {
    // 199 × 0.177 = 35.223
    expect(computeNetPrice(19_900, 82.3, 'nearest_paisa')).toBe(3_522);
    expect(computeNetPrice(19_900, 82.3, 'nearest_rupee')).toBe(3_500);
  });

  it('rounds exact halves up', () => {
    expect(computeNetPrice(1_000, 85, 'nearest_rupee')).toBe(200); // ₹1.50 → ₹2
    expect(computeNetPrice(1_000, 85, 'nearest_paisa')).toBe(150);
    expect(computeNetPrice(1_001, 50, 'nearest_paisa')).toBe(501); // 500.5 → 501
  });

  it('handles 0%, 100% and exact discounts', () => {
    expect(computeNetPrice(19_900, 0)).toBe(19_900);
    expect(computeNetPrice(19_900, 100)).toBe(0);
    expect(computeNetPrice(25_000, 80)).toBe(5_000);
  });

  it('rejects invalid input', () => {
    expect(() => computeNetPrice(199.5, 10)).toThrow(RangeError);
    expect(() => computeNetPrice(-1, 10)).toThrow(RangeError);
    expect(() => computeNetPrice(1_000, 101)).toThrow(RangeError);
    expect(() => computeNetPrice(1_000, 82.555)).toThrow(/2 decimal/);
  });
});

describe('helpers', () => {
  it('percentToBasisPoints', () => {
    expect(percentToBasisPoints(82.5)).toBe(8_250);
    expect(percentToBasisPoints(17.7)).toBe(1_770);
  });

  it('divRoundHalfUp', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });

  it('roundToRupee', () => {
    expect(roundToRupee(3_449)).toBe(3_400);
    expect(roundToRupee(3_450)).toBe(3_500);
    expect(roundToRupee(3_483)).toBe(3_500);
  });
});

describe('inclusive GST', () => {
  it('back-calculates taxable value; parts always sum to gross', () => {
    expect(splitInclusiveGst(11_800, 18)).toEqual({ taxable: 10_000, tax: 1_800 });
    expect(splitInclusiveGst(3_500, 18)).toEqual({ taxable: 2_966, tax: 534 });
    for (const gross of [1, 99, 3_483, 123_457, 999_999]) {
      for (const rate of [0, 5, 12, 18, 28]) {
        const { taxable, tax } = splitInclusiveGst(gross, rate);
        expect(taxable + tax).toBe(gross);
      }
    }
  });

  it('splits CGST/SGST with the odd paisa on CGST', () => {
    expect(splitCgstSgst(534)).toEqual({ cgst: 267, sgst: 267 });
    expect(splitCgstSgst(535)).toEqual({ cgst: 268, sgst: 267 });
  });
});
