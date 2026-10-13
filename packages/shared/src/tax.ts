import { INDIAN_STATES, type IndianStateCode } from './states.js';

export const HSN_REGEX = /^[0-9]{4}([0-9]{2}){0,2}$/; // 4, 6 or 8 digits

export interface TaxSource {
  hsn?: string | null;
  taxRate?: number | null;
}

/**
 * Effective HSN / tax rate: product override → category override → store default.
 * `null`/`undefined` means "inherit"; a rate of 0 is a valid explicit value.
 */
export function resolveTax(
  product: TaxSource,
  category: TaxSource | null | undefined,
  defaults: { hsn: string; taxRate: number },
): { hsn: string; taxRate: number } {
  return {
    hsn: product.hsn ?? category?.hsn ?? defaults.hsn,
    taxRate: product.taxRate ?? category?.taxRate ?? defaults.taxRate,
  };
}

/**
 * Like {@link resolveTax}, for when the store defaults may not be set yet (they live in
 * Settings, never in code): a part that nothing sets comes back `null`.
 */
export function resolveTaxIfSet(
  product: TaxSource,
  category: TaxSource | null | undefined,
  defaults: TaxSource | null | undefined,
): { hsn: string | null; taxRate: number | null } {
  return {
    hsn: product.hsn ?? category?.hsn ?? defaults?.hsn ?? null,
    taxRate: product.taxRate ?? category?.taxRate ?? defaults?.taxRate ?? null,
  };
}

export function gstStateCodeOf(code: IndianStateCode): string {
  const state = INDIAN_STATES.find((s) => s.code === code);
  if (!state) throw new RangeError(`Unknown state code ${code}`);
  return state.gstCode;
}

/** Inter-state supply ⇒ IGST; intra-state ⇒ CGST + SGST. */
export function isInterStateSupply(sellerState: IndianStateCode, buyerState: IndianStateCode): boolean {
  return sellerState !== buyerState;
}
