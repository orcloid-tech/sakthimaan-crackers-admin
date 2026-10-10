import { INDIAN_STATES, type IndianStateCode } from './states.js';

/** Seller (store) home state: Tamil Nadu, GST state code 33. Overridable in settings. */
export const DEFAULT_SELLER_STATE_CODE: IndianStateCode = 'TN';
export const DEFAULT_HSN = '3604'; // Fireworks
export const DEFAULT_TAX_RATE = 18; // %, to be confirmed by the client's accountant (configurable)

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

export function gstStateCodeOf(code: IndianStateCode): string {
  const state = INDIAN_STATES.find((s) => s.code === code);
  if (!state) throw new RangeError(`Unknown state code ${code}`);
  return state.gstCode;
}

/** Inter-state supply ⇒ IGST; intra-state ⇒ CGST + SGST. */
export function isInterStateSupply(sellerState: IndianStateCode, buyerState: IndianStateCode): boolean {
  return sellerState !== buyerState;
}
