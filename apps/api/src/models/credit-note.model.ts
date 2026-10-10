import { Schema, model, type InferSchemaType } from 'mongoose';
import { immutablePlugin } from './plugins/immutable.plugin.js';
import { taxDocumentFields } from './tax-document.schemas.js';

export const CREDIT_NOTE_REASONS = ['order_cancelled', 'goods_returned', 'price_adjustment'] as const;

/**
 * GST credit note against an issued invoice, with its own number series
 * (`credit_note:<FY>` counter, default format SMC/CN/26-27/001). Created in the same
 * transaction as the order cancellation. Fully immutable.
 */
const creditNoteSchema = new Schema(
  {
    ...taxDocumentFields,
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNumber: { type: String, required: true },
    invoiceDate: { type: Date, required: true },
    reasonCode: { type: String, enum: CREDIT_NOTE_REASONS, required: true },
    reason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

creditNoteSchema.plugin(immutablePlugin, { mutablePaths: [] });

creditNoteSchema.index({ number: 1 }, { unique: true });
creditNoteSchema.index({ financialYear: 1, seq: 1 }, { unique: true });
creditNoteSchema.index({ invoice: 1 });
creditNoteSchema.index({ order: 1 });
creditNoteSchema.index({ issuedAt: -1 });

export type CreditNote = InferSchemaType<typeof creditNoteSchema>;
export const CreditNoteModel = model('CreditNote', creditNoteSchema);
