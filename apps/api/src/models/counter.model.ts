import { Schema, model } from 'mongoose';

/**
 * Atomic sequences for gap-free numbering, e.g. `_id: "invoice:26-27"`, `"credit_note:26-27"`, `"order:26-27"`
 * (keys from shared `counterKey()`).
 * Incremented with findOneAndUpdate({ $inc: { seq: 1 } }, { upsert: true }) inside the
 * same transaction as the document that consumes the number.
 */
const counterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0, required: true },
  },
  { versionKey: false },
);

export const CounterModel = model('Counter', counterSchema);
