import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CREDIT_NOTE_FORMAT,
  DEFAULT_INVOICE_FORMAT,
  counterKey,
  financialYearOf,
  formatDocumentNumber,
  validateDocumentNumberFormat,
} from './document-number.js';

describe('financialYearOf (April–March, IST)', () => {
  it('maps dates to the Indian financial year', () => {
    expect(financialYearOf(new Date('2026-10-10T12:00:00+05:30'))).toEqual({
      startYear: 2026,
      short: '26-27',
      long: '2026-27',
    });
    expect(financialYearOf(new Date('2027-03-31T23:59:59+05:30')).short).toBe('26-27');
    expect(financialYearOf(new Date('2026-04-01T00:00:00+05:30')).short).toBe('26-27');
  });

  it('uses IST, not UTC, at the year boundary', () => {
    // 2027-03-31 18:30 UTC is already 1 April in India.
    expect(financialYearOf(new Date('2027-03-31T18:30:00Z')).short).toBe('27-28');
  });

  it('handles the century wrap', () => {
    expect(financialYearOf(new Date('2099-06-01T00:00:00+05:30')).short).toBe('99-00');
  });
});

describe('formatDocumentNumber', () => {
  const fy = financialYearOf(new Date('2026-10-10T12:00:00+05:30'));

  it('default invoice format is SMC/26-27/00042 (15 chars)', () => {
    const n = formatDocumentNumber(DEFAULT_INVOICE_FORMAT, { prefix: 'SMC', fy, seq: 42 });
    expect(n).toBe('SMC/26-27/00042');
    expect(n.length).toBe(15);
    // still within 16 chars past the padded width
    expect(formatDocumentNumber(DEFAULT_INVOICE_FORMAT, { prefix: 'SMC', fy, seq: 100_000 })).toBe('SMC/26-27/100000');
  });

  it('default credit note format is SMC/CN/26-27/001 (16 chars)', () => {
    expect(formatDocumentNumber(DEFAULT_CREDIT_NOTE_FORMAT, { prefix: 'SMC', fy, seq: 1 })).toBe('SMC/CN/26-27/001');
  });

  it('refuses to produce a number longer than 16 chars', () => {
    expect(() => formatDocumentNumber('{PREFIX}/CN/{FY}/{SEQ:4}', { prefix: 'SMC', fy, seq: 1 })).toThrow(/16/);
  });

  it('counter keys are per series and financial year', () => {
    expect(counterKey('invoice', fy)).toBe('invoice:26-27');
    expect(counterKey('credit_note', fy)).toBe('credit_note:26-27');
  });
});

describe('validateDocumentNumberFormat', () => {
  it('accepts the defaults', () => {
    expect(validateDocumentNumberFormat(DEFAULT_INVOICE_FORMAT, 'SMC')).toEqual([]);
    expect(validateDocumentNumberFormat(DEFAULT_CREDIT_NOTE_FORMAT, 'SMC')).toEqual([]);
  });

  it('rejects formats that can exceed 16 chars, lack FY/SEQ, or use invalid characters', () => {
    expect(validateDocumentNumberFormat('{PREFIX}/CN/{FY}/{SEQ:4}', 'SMC')[0]).toMatch(/17 chars/);
    expect(validateDocumentNumberFormat('{PREFIX}/{SEQ:5}', 'SMC')).toContainEqual(expect.stringMatching(/\{FY\}/));
    expect(validateDocumentNumberFormat('{PREFIX}/{FY}', 'SMC')).toContainEqual(expect.stringMatching(/SEQ/));
    expect(validateDocumentNumberFormat('{PREFIX}_{FY}_{SEQ:4}', 'SMC')).toContainEqual(
      expect.stringMatching(/allowed/),
    );
    expect(validateDocumentNumberFormat('{PREFIX}/{FY}/{SEQ:4}', 'S M')).toContainEqual(
      expect.stringMatching(/Prefix/),
    );
  });
});
