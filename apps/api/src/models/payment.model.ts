import { Schema, model, type InferSchemaType } from 'mongoose';
import { PAYMENT_KINDS, PAYMENT_METHODS, PAYMENT_RECORD_STATUSES } from '@sakthimaan/shared';
import { actorSchema, imageSchema, integerValidator } from './common.schemas.js';

/**
 * Manual payment records (no gateway): UPI / bank transfer / cash with a reference
 * number (UTR) and optional screenshot. Orders can be part-paid.
 *
 * - Staff-entered payments start as `recorded`.
 * - Customers may submit proof from the website: `submitted`, then staff verify
 *   (→ `recorded`) or reject it. Only `recorded` rows count towards `order.amountPaid`.
 * - Records are never edited or deleted; mistakes are `voided` with a reason.
 */
const paymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNo: { type: String, required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    kind: { type: String, enum: PAYMENT_KINDS, default: 'payment', required: true },
    amount: { type: Number, required: true, min: 1, validate: integerValidator }, // paise, always positive
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true, uppercase: true, maxlength: 100 }, // UTR / txn id
    paidAt: { type: Date, required: true },
    screenshot: { type: imageSchema },
    notes: { type: String, trim: true, maxlength: 500 },
    source: { type: String, enum: ['staff', 'customer'], required: true },

    status: { type: String, enum: PAYMENT_RECORD_STATUSES, required: true },
    recordedBy: { type: actorSchema }, // staff who entered or verified it
    recordedAt: { type: Date },
    rejectedReason: { type: String, trim: true, maxlength: 300 },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, maxlength: 300 },
    voidedBy: { type: actorSchema },
  },
  { timestamps: true },
);

paymentSchema.index({ order: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 }); // "proofs awaiting verification" queue
paymentSchema.index({ paidAt: -1, method: 1 }); // payment collection report
paymentSchema.index({ reference: 1 }, { sparse: true }); // duplicate-UTR warning

export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema);
