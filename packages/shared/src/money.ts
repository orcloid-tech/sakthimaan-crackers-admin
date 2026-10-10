/**
 * All money is stored and transmitted as integer paise (₹1 = 100 paise).
 * Percentages (discount, tax) are converted to integer basis points before any
 * arithmetic, so results never depend on floating-point representation
 * (e.g. 100 - 82.3 = 17.700000000000003).
 */

export type Paise = number;

export const NET_PRICE_ROUNDING_MODES = ['nearest_rupee', 'nearest_paisa'] as const;
export type NetPriceRounding = (typeof NET_PRICE_ROUNDING_MODES)[number];
export const DEFAULT_NET_PRICE_ROUNDING: NetPriceRounding = 'nearest_rupee';

/** Upper bound for a single amount (₹1 crore) — keeps every intermediate product a safe integer. */
export const MAX_AMOUNT_PAISE = 1_000_000_000;

const FULL_BP = 10_000; // 100% in basis points

export function assertPaise(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT_PAISE) {
    throw new RangeError(`${label} must be an integer number of paise between 0 and ${MAX_AMOUNT_PAISE}`);
  }
}

/** Converts a percentage with at most 2 decimals (e.g. 82.5) to basis points (8250). */
export function percentToBasisPoints(pct: number, label = 'percentage'): number {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`${label} must be between 0 and 100`);
  }
  const bp = Math.round(pct * 100);
  if (Math.abs(bp - pct * 100) > 1e-6) {
    throw new RangeError(`${label} may have at most 2 decimal places`);
  }
  return bp;
}

/** Integer division of non-negative integers, rounding halves up. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (numerator < 0 || denominator <= 0) throw new RangeError('divRoundHalfUp expects n >= 0, d > 0');
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/** Rounds an amount in paise to the nearest whole rupee (halves up). */
export function roundToRupee(paise: Paise): Paise {
  return divRoundHalfUp(paise, 100) * 100;
}

/**
 * Net selling price after the Sivakasi-style discount.
 * `nearest_rupee` (default): ₹199 at 82.5% → ₹34.825 → ₹35.00
 * `nearest_paisa`:           ₹199 at 82.5% → ₹34.825 → ₹34.83
 */
export function computeNetPrice(
  mrp: Paise,
  discountPct: number,
  rounding: NetPriceRounding = DEFAULT_NET_PRICE_ROUNDING,
): Paise {
  assertPaise(mrp, 'mrp');
  const keepBp = FULL_BP - percentToBasisPoints(discountPct, 'discountPct');
  const scaled = mrp * keepBp; // paise × bp, exact
  return rounding === 'nearest_paisa'
    ? divRoundHalfUp(scaled, FULL_BP)
    : divRoundHalfUp(scaled, FULL_BP * 100) * 100;
}

/**
 * Splits a GST-inclusive amount into taxable value and tax (back-calculation).
 * taxable = gross × 100 / (100 + rate); tax = gross − taxable, so the parts always sum to gross.
 */
export function splitInclusiveGst(gross: Paise, taxRatePct: number): { taxable: Paise; tax: Paise } {
  assertPaise(gross, 'gross');
  const rateBp = percentToBasisPoints(taxRatePct, 'taxRate');
  const taxable = divRoundHalfUp(gross * FULL_BP, FULL_BP + rateBp);
  return { taxable, tax: gross - taxable };
}

/** Splits an intra-state tax amount into CGST and SGST halves; any odd paisa goes to CGST. */
export function splitCgstSgst(tax: Paise): { cgst: Paise; sgst: Paise } {
  const cgst = Math.ceil(tax / 2);
  return { cgst, sgst: tax - cgst };
}

export function formatINR(paise: Paise): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}
