import type { SetupItem, SetupStatus } from '@sakthimaan/shared';
import type { Settings } from '../models/index.js';
import { AppError } from '../utils/app-error.js';

/**
 * Business values live in Settings, never in code. This lists what is still missing and
 * what each gap holds up, so screens can show "Add your GSTIN in Settings" instead of
 * inventing a value:
 * - orders: no order can be priced (GST needs the seller's state; lines need a GST rate),
 * - invoices: a GST invoice can't be issued (legal name, GSTIN, address, number prefix),
 * - recommended: customers see it (phone, UPI or bank details).
 */
/** `serviceableStates`: how many states delivery is switched on for (omit if unknown). */
export function setupStatus(s: Settings | null, serviceableStates?: number): SetupStatus {
  const missing: SetupItem[] = [];
  const add = (key: string, label: string, tab: SetupItem['tab'], blocks: SetupItem['blocks']) =>
    missing.push({ key, label, tab, blocks });
  const c = s?.company;

  if (!s?.tax?.sellerStateCode)
    add('sellerStateCode', 'Business state (decides CGST + SGST or IGST)', 'billing', 'orders');
  if (s?.tax?.defaultTaxRate == null) add('defaultTaxRate', 'Default GST rate', 'billing', 'orders');
  if (!s?.tax?.defaultHsn) add('defaultHsn', 'Default HSN code', 'billing', 'orders');
  if (serviceableStates === 0)
    add('deliveryStates', 'Delivery: switch on the states you deliver to', 'shipping', 'orders');

  if (!c?.name) add('companyName', 'Store name', 'company', 'invoices');
  if (!c?.gstin) add('gstin', 'GSTIN', 'company', 'invoices');
  if (!c?.address?.line1) add('address', 'Business address', 'company', 'invoices');
  if (!s?.invoice?.prefix) add('invoicePrefix', 'Invoice number prefix', 'billing', 'invoices');

  if (!c?.phones?.length) add('phones', 'Phone number', 'company', 'recommended');
  if (!s?.payment?.upiId && !s?.payment?.bank?.accountNumber)
    add('payment', 'UPI ID or bank account', 'payments', 'recommended');

  // Default GST rate / HSN only hold up products whose category has none, so they don't
  // make orders "not ready" on their own (the order builder checks each line).
  const ordersReady = !missing.some((m) => m.key === 'sellerStateCode' || m.key === 'deliveryStates');
  return {
    ordersReady,
    invoicesReady: ordersReady && !missing.some((m) => m.blocks === 'invoices'),
    missing,
  };
}

/** 409 SETUP_INCOMPLETE naming what to fill in, e.g. "Add these in Settings first: GSTIN, Invoice number prefix". */
export function setupIncomplete(what: string, gaps: SetupItem[]): AppError {
  return new AppError(
    409,
    'SETUP_INCOMPLETE',
    `${what}. Add these in Settings first: ${gaps.map((g) => g.label).join(', ')}.`,
    { missing: gaps },
  );
}

/**
 * Orders need the seller's state (GST type). GST rates are checked per line by the order
 * builder, since a category's own rate makes the store default unnecessary.
 */
export function assertCanPrice(s: Settings | null): void {
  const gaps = setupStatus(s).missing.filter((m) => m.key === 'sellerStateCode');
  if (gaps.length) throw setupIncomplete('Orders can’t be priced yet', gaps);
}

export function assertCanInvoice(s: Settings | null): void {
  const gaps = setupStatus(s).missing.filter((m) => m.blocks === 'invoices' || m.key === 'sellerStateCode');
  if (gaps.length) throw setupIncomplete('Invoices can’t be issued yet', gaps);
}
