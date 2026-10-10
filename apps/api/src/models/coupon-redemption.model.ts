import { Schema, model, type InferSchemaType } from 'mongoose';

/** One row per coupon use; enforces per-customer limits and makes redemption idempotent per order. */
const couponRedemptionSchema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    discount: { type: Number, required: true }, // paise
    releasedAt: { type: Date, default: null }, // set when the order is cancelled
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

couponRedemptionSchema.index({ coupon: 1, order: 1 }, { unique: true });
couponRedemptionSchema.index({ coupon: 1, customer: 1, releasedAt: 1 });

export type CouponRedemption = InferSchemaType<typeof couponRedemptionSchema>;
export const CouponRedemptionModel = model('CouponRedemption', couponRedemptionSchema);
