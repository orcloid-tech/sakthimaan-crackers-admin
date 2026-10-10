import { COUPON_TYPES } from './enums.js';
import {
  type Paise,
  assertPaise,
  divRoundHalfUp,
  percentToBasisPoints,
  roundToRupee,
  splitCgstSgst,
  splitInclusiveGst,
} from './money.js';
import type { IndianStateCode } from './states.js';
import { isInterStateSupply } from './tax.js';

/**
 * Order pricing engine, shared by the API (authoritative) and the admin UI (live preview).
 * Prices are GST-inclusive: the taxable value is back-calculated per line.
 */

export interface PricingLineInput {
  /** Unit MRP and net price are snapshots taken when the line was added. */
  mrp: Paise;
  netPrice: Paise;
  qty: number;
  hsn: string;
  taxRate: number;
}

export interface PricingInput {
  lines: readonly PricingLineInput[];
  /** Coupon discount on the order (already computed, see computeCouponDiscount). */
  couponDiscount?: Paise;
  /** Prepaid delivery / packing charges (GST-inclusive). `to_pay` delivery = 0. */
  deliveryCharge?: Paise;
  packingCharge?: Paise;
  /**
   * Delivery/packing billed by the seller form a composite supply with the goods, so they
   * take the principal supply's HSN and rate (store defaults: 3604 / 18%).
   */
  chargesHsn: string;
  chargesTaxRate: number;
  sellerStateCode: IndianStateCode;
  buyerStateCode: IndianStateCode;
}

export interface TaxParts {
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

export interface PricedLine extends TaxParts {
  lineMrpTotal: Paise;
  lineTotal: Paise; // netPrice × qty, before coupon
  couponShare: Paise; // part of the coupon discount allocated to this line
}

export interface HsnSummaryRow extends TaxParts {
  hsn: string;
  taxRate: number;
}

export interface PricingResult extends TaxParts {
  lines: PricedLine[];
  mrpTotal: Paise;
  productDiscount: Paise; // mrpTotal − subtotal
  subtotal: Paise; // Σ lineTotal
  couponDiscount: Paise;
  deliveryCharge: Paise;
  packingCharge: Paise;
  charges: TaxParts & { taxRate: number };
  totalTax: Paise;
  grossTotal: Paise; // before round-off
  roundOff: Paise; // signed, −50..+50 paise
  grandTotal: Paise; // whole rupees
  isInterState: boolean;
  hsnSummary: HsnSummaryRow[];
}

function taxParts(gross: Paise, rate: number, interState: boolean): TaxParts {
  const { taxable, tax } = splitInclusiveGst(gross, rate);
  if (interState) return { taxableValue: taxable, cgst: 0, sgst: 0, igst: tax };
  const { cgst, sgst } = splitCgstSgst(tax);
  return { taxableValue: taxable, cgst, sgst, igst: 0 };
}

/**
 * Splits `amount` across `weights` proportionally, using the largest-remainder method
 * so the parts are integers that sum exactly to `amount`.
 */
export function allocateProportionally(amount: Paise, weights: readonly Paise[]): Paise[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  if (amount > total) throw new RangeError('Cannot allocate more than the total weight');
  // BigInt keeps amount × weight exact for any realistic order size.
  const a = BigInt(amount);
  const t = BigInt(total);
  const shares = weights.map((w, i) => {
    const num = a * BigInt(w);
    return { i, floor: num / t, rem: num % t };
  });
  const parts = shares.map((s) => Number(s.floor));
  let remainder = amount - parts.reduce((x, y) => x + y, 0);
  const byRemainder = [...shares].sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.i - y.i));
  for (const { i } of byRemainder) {
    if (remainder === 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    remainder -= 1;
  }
  return parts;
}

export function priceOrder(input: PricingInput): PricingResult {
  const couponDiscount = input.couponDiscount ?? 0;
  const deliveryCharge = input.deliveryCharge ?? 0;
  const packingCharge = input.packingCharge ?? 0;
  [couponDiscount, deliveryCharge, packingCharge].forEach((v) => assertPaise(v));
  const interState = isInterStateSupply(input.sellerStateCode, input.buyerStateCode);

  const base = input.lines.map((l) => {
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) throw new RangeError('qty must be a positive integer');
    assertPaise(l.mrp, 'mrp');
    assertPaise(l.netPrice, 'netPrice');
    return { lineMrpTotal: l.mrp * l.qty, lineTotal: l.netPrice * l.qty };
  });
  const subtotal = base.reduce((s, l) => s + l.lineTotal, 0);
  const mrpTotal = base.reduce((s, l) => s + l.lineMrpTotal, 0);
  if (couponDiscount > subtotal) throw new RangeError('Coupon discount exceeds subtotal');

  const shares = allocateProportionally(
    couponDiscount,
    base.map((l) => l.lineTotal),
  );

  const lines: PricedLine[] = base.map((l, i) => {
    const src = input.lines[i]!;
    const share = shares[i] ?? 0;
    return { ...l, couponShare: share, ...taxParts(l.lineTotal - share, src.taxRate, interState) };
  });

  const charges = {
    taxRate: input.chargesTaxRate,
    ...taxParts(deliveryCharge + packingCharge, input.chargesTaxRate, interState),
  };

  // HSN-wise summary (required on GST invoices); charges are folded into the principal HSN row.
  const summary = new Map<string, HsnSummaryRow>();
  const addToSummary = (hsn: string, taxRate: number, p: TaxParts) => {
    const key = `${hsn}|${taxRate}`;
    const row = summary.get(key) ?? { hsn, taxRate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxableValue += p.taxableValue;
    row.cgst += p.cgst;
    row.sgst += p.sgst;
    row.igst += p.igst;
    summary.set(key, row);
  };
  lines.forEach((l, i) => addToSummary(input.lines[i]!.hsn, input.lines[i]!.taxRate, l));
  if (deliveryCharge + packingCharge > 0) addToSummary(input.chargesHsn, input.chargesTaxRate, charges);

  const all: TaxParts[] = [...lines, charges];
  const sum = (k: keyof TaxParts) => all.reduce((s, p) => s + p[k], 0);
  const taxableValue = sum('taxableValue');
  const cgst = sum('cgst');
  const sgst = sum('sgst');
  const igst = sum('igst');
  const totalTax = cgst + sgst + igst;

  const grossTotal = subtotal - couponDiscount + deliveryCharge + packingCharge;
  const grandTotal = roundToRupee(grossTotal);

  return {
    lines,
    mrpTotal,
    productDiscount: mrpTotal - subtotal,
    subtotal,
    couponDiscount,
    deliveryCharge,
    packingCharge,
    charges,
    taxableValue,
    cgst,
    sgst,
    igst,
    totalTax,
    grossTotal,
    roundOff: grandTotal - grossTotal,
    grandTotal,
    isInterState: interState,
    hsnSummary: [...summary.values()],
  };
}

export interface CouponRule {
  type: (typeof COUPON_TYPES)[number];
  /** paise for flat, percent for percent */
  value: number;
  maxDiscount?: Paise | null;
  minOrderValue?: Paise | null;
}

/** Discount (paise) for an eligible subtotal; 0 if the minimum isn't met. Never exceeds the subtotal. */
export function computeCouponDiscount(rule: CouponRule, eligibleSubtotal: Paise): Paise {
  assertPaise(eligibleSubtotal, 'eligibleSubtotal');
  if (rule.minOrderValue && eligibleSubtotal < rule.minOrderValue) return 0;
  let discount =
    rule.type === 'flat'
      ? rule.value
      : divRoundHalfUp(eligibleSubtotal * percentToBasisPoints(rule.value, 'coupon value'), 10_000);
  if (rule.maxDiscount != null) discount = Math.min(discount, rule.maxDiscount);
  return Math.min(discount, eligibleSubtotal);
}
