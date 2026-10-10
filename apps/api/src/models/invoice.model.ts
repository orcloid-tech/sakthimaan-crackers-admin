import { Schema, model, type InferSchemaType } from 'mongoose';
import { INVOICE_STATUSES } from '@sakthimaan/shared';
import { immutablePlugin } from './plugins/immutable.plugin.js';
import { taxDocumentFields } from './tax-document.schemas.js';

/**
 * GST tax invoice. Issued once per order (number from the `invoice:<FY>` counter in the
 * same transaction, so the series has no gaps). Never edited or deleted, and its number
 * is never reused: cancelling the order issues a CreditNote and marks this invoice
 * `cancelled`, which (with the link to that credit note) is the only change allowed.
 */
const invoiceSchema = new Schema(
  {
    ...taxDocumentFields,
    terms: { type: String },
    footerNote: { type: String },
    status: { type: String, enum: INVOICE_STATUSES, default: 'issued', required: true },
    cancelledBy: {
      creditNote: { type: Schema.Types.ObjectId, ref: 'CreditNote' },
      number: { type: String },
      at: { type: Date },
    },
  },
  { timestamps: true },
);

invoiceSchema.plugin(immutablePlugin, { mutablePaths: ['status', 'cancelledBy'] });

invoiceSchema.index({ number: 1 }, { unique: true });
invoiceSchema.index({ financialYear: 1, seq: 1 }, { unique: true });
invoiceSchema.index({ order: 1 }, { unique: true }); // one invoice per order
invoiceSchema.index({ issuedAt: -1 }); // GST report
invoiceSchema.index({ status: 1, issuedAt: -1 });

export type Invoice = InferSchemaType<typeof invoiceSchema>;
export const InvoiceModel = model('Invoice', invoiceSchema);
