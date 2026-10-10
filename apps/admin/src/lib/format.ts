import { formatINR, type Paise } from '@sakthimaan/shared';

export { formatINR };

/** ₹1,234 without paise when whole, otherwise ₹1,234.50. */
export function money(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/** Rupee text typed by a user ("1,299.50", "₹ 35") → paise, or null if not a valid amount. */
export function parseRupees(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function rupeesText(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export function number(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN').format(n);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${number(n)} ${n === 1 ? one : many}`;
}
