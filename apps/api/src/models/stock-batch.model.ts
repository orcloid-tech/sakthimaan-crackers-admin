import { Schema, model, type InferSchemaType } from 'mongoose';
import { integerValidator } from './common.schemas.js';

/** Optional lot tracking (enabled per product via `trackBatches`). FIFO by receivedAt. */
const stockBatchSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    lotNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 60 },
    supplier: { type: String, trim: true, maxlength: 150 },
    manufacturedAt: { type: Date },
    receivedAt: { type: Date, required: true, default: () => new Date() },
    qtyReceived: { type: Number, required: true, min: 1, validate: integerValidator },
    qtyRemaining: { type: Number, required: true, min: 0, validate: integerValidator },
    costPrice: { type: Number, min: 0, validate: integerValidator }, // paise per unit
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

stockBatchSchema.index({ product: 1, lotNumber: 1 }, { unique: true });
stockBatchSchema.index({ product: 1, qtyRemaining: 1, receivedAt: 1 });

export type StockBatch = InferSchemaType<typeof stockBatchSchema>;
export const StockBatchModel = model('StockBatch', stockBatchSchema);
