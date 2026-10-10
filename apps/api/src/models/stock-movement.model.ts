import { Schema, model, type InferSchemaType } from 'mongoose';
import { STOCK_MOVEMENT_TYPES } from '@sakthimaan/shared';
import { actorSchema, integerValidator } from './common.schemas.js';

/**
 * Append-only stock ledger. Written in the same transaction as the product
 * stock change, so `balanceAfter` always matches the product's stock at that point.
 */
const stockMovementSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'StockBatch', default: null },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    qty: { type: Number, required: true, validate: integerValidator }, // signed: +in / -out
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, maxlength: 300 },
    refType: { type: String, enum: ['order', 'import', 'manual'], required: true },
    refId: { type: Schema.Types.ObjectId, default: null },
    refLabel: { type: String }, // e.g. order number, for display without a join
    actor: { type: actorSchema, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.index({ product: 1, createdAt: -1 });
stockMovementSchema.index({ refType: 1, refId: 1 });
stockMovementSchema.index({ type: 1, createdAt: -1 });
stockMovementSchema.index({ createdAt: -1 });

export type StockMovement = InferSchemaType<typeof stockMovementSchema>;
export const StockMovementModel = model('StockMovement', stockMovementSchema);
