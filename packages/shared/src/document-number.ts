/**
 * GST invoice / credit-note numbering (CGST Rule 46(b)): a consecutive serial of at most
 * 16 characters, unique per financial year, using only letters, digits, "-" and "/".
 *
 * Format tokens: {PREFIX}, {FY} (short FY, e.g. "26-27"), {SEQ:n} (zero-padded to n digits).
 */

export const GST_DOC_NUMBER_MAX_LENGTH = 16;
const ALLOWED_CHARS = /^[A-Za-z0-9/-]+$/;
const SEQ_TOKEN = /\{SEQ:(\d)\}/;

export const DEFAULT_INVOICE_PREFIX = 'SMC';
export const DEFAULT_INVOICE_FORMAT = '{PREFIX}/{FY}/{SEQ:5}'; // SMC/26-27/00042  (15 chars)
export const DEFAULT_CREDIT_NOTE_FORMAT = 'CN/{FY}/{SEQ:5}'; // CN/26-27/00001 (14 chars)

export interface FinancialYear {
  startYear: number; // 2026 for Apr 2026 – Mar 2027
  short: string; // "26-27"
  long: string; // "2026-27"
}

/** Indian financial year (April–March) of a date, evaluated in IST. */
export function financialYearOf(date: Date): FinancialYear {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const startYear = month >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return {
    startYear,
    short: `${yy(startYear)}-${yy(startYear + 1)}`,
    long: `${startYear}-${yy(startYear + 1)}`,
  };
}

export function formatDocumentNumber(
  format: string,
  values: { prefix: string; fy: FinancialYear; seq: number },
): string {
  if (!Number.isSafeInteger(values.seq) || values.seq < 1) throw new RangeError('seq must be >= 1');
  const out = format
    .replaceAll('{PREFIX}', values.prefix)
    .replaceAll('{FY}', values.fy.short)
    .replace(SEQ_TOKEN, (_, width: string) => String(values.seq).padStart(Number(width), '0'));
  if (out.length > GST_DOC_NUMBER_MAX_LENGTH) {
    throw new RangeError(`Document number "${out}" exceeds ${GST_DOC_NUMBER_MAX_LENGTH} characters`);
  }
  if (!ALLOWED_CHARS.test(out)) throw new RangeError(`Document number "${out}" has invalid characters`);
  return out;
}

/**
 * Validates a numbering format before it is saved in settings. The longest number the
 * format can produce (with the sequence at its padded maximum) must fit in 16 chars.
 */
export function validateDocumentNumberFormat(format: string, prefix: string): string[] {
  const errors: string[] = [];
  const seq = SEQ_TOKEN.exec(format);
  if (!seq) errors.push('Format must contain {SEQ:n} (n = 1–9 digits)');
  if (!format.includes('{FY}'))
    errors.push('Format must contain {FY} (numbers restart every financial year)');
  if (!/^[A-Za-z0-9]{1,10}$/.test(prefix)) errors.push('Prefix must be 1–10 letters/digits');
  if (errors.length > 0) return errors;
  const width = Number(seq![1]);
  const sample = format
    .replaceAll('{PREFIX}', prefix)
    .replaceAll('{FY}', '00-00')
    .replace(SEQ_TOKEN, '9'.repeat(width));
  if (/[{}]/.test(sample)) errors.push('Unknown token in format');
  else if (!ALLOWED_CHARS.test(sample)) errors.push('Only letters, digits, "-" and "/" are allowed');
  if (sample.length > GST_DOC_NUMBER_MAX_LENGTH) {
    errors.push(
      `Longest number "${sample}" is ${sample.length} chars; GST allows ${GST_DOC_NUMBER_MAX_LENGTH}`,
    );
  }
  return errors;
}

/** Counter document id for a series, e.g. "invoice:26-27". */
export function counterKey(series: 'invoice' | 'credit_note' | 'order', fy: FinancialYear): string {
  return `${series}:${fy.short}`;
}
