import type { ClientSession } from 'mongoose';
import {
  DEFAULT_CREDIT_NOTE_FORMAT,
  DEFAULT_INVOICE_FORMAT,
  DEFAULT_INVOICE_PREFIX,
  counterKey,
  financialYearOf,
  formatDocumentNumber,
  type FinancialYear,
} from '@sakthimaan/shared';
import { CounterModel, type Settings } from '../../models/index.js';

/**
 * Consecutive numbers per financial year. The counter is incremented inside the caller's
 * transaction, so an aborted document never consumes a number (no gaps in GST series).
 */
async function nextSeq(
  series: 'order' | 'invoice' | 'credit_note',
  fy: FinancialYear,
  session: ClientSession,
): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate(
    { _id: counterKey(series, fy) },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  ).lean();
  if (!counter) throw new Error('Counter update failed');
  return counter.seq;
}

export async function nextOrderNo(
  settings: Settings | null,
  session: ClientSession,
  now = new Date(),
): Promise<string> {
  const fy = financialYearOf(now);
  const seq = await nextSeq('order', fy, session);
  const prefix = settings?.order?.numberPrefix ?? 'ORD';
  return `${prefix}/${fy.short}/${String(seq).padStart(6, '0')}`;
}

export async function nextInvoiceNo(settings: Settings | null, session: ClientSession, now = new Date()) {
  const fy = financialYearOf(now);
  const seq = await nextSeq('invoice', fy, session);
  const number = formatDocumentNumber(settings?.invoice?.format ?? DEFAULT_INVOICE_FORMAT, {
    prefix: settings?.invoice?.prefix ?? DEFAULT_INVOICE_PREFIX,
    fy,
    seq,
  });
  return { number, seq, financialYear: fy.short };
}

export async function nextCreditNoteNo(settings: Settings | null, session: ClientSession, now = new Date()) {
  const fy = financialYearOf(now);
  const seq = await nextSeq('credit_note', fy, session);
  const number = formatDocumentNumber(settings?.invoice?.creditNoteFormat ?? DEFAULT_CREDIT_NOTE_FORMAT, {
    prefix: settings?.invoice?.prefix ?? DEFAULT_INVOICE_PREFIX,
    fy,
    seq,
  });
  return { number, seq, financialYear: fy.short };
}
