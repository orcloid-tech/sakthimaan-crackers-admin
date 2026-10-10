import { type Paise, assertPaise } from './money.js';

/** Renders `{{placeholder}}` templates; unknown placeholders render as empty strings. */
export function renderTemplate(body: string, vars: Readonly<Record<string, string | number>>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : '',
  );
}

/**
 * Click-to-chat link (no WhatsApp provider needed): staff click it, WhatsApp opens
 * with the message prefilled, and they press send.
 */
export function buildWhatsAppLink(mobile10: string, message: string): string {
  if (!/^[6-9][0-9]{9}$/.test(mobile10)) throw new RangeError('Expected a 10-digit Indian mobile number');
  return `https://wa.me/91${mobile10}?text=${encodeURIComponent(message)}`;
}

/** UPI deep link (also the payload for the UPI QR code shown on storefront / invoice). */
export function buildUpiUri(params: {
  vpa: string;
  payeeName: string;
  amount?: Paise;
  note?: string;
}): string {
  if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(params.vpa)) throw new RangeError('Invalid UPI ID');
  const q = new URLSearchParams({ pa: params.vpa, pn: params.payeeName, cu: 'INR' });
  if (params.amount !== undefined) {
    assertPaise(params.amount);
    q.set('am', (params.amount / 100).toFixed(2));
  }
  if (params.note) q.set('tn', params.note.slice(0, 80));
  return `upi://pay?${q.toString()}`;
}
