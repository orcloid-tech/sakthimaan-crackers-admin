import { Schema, model, type InferSchemaType } from 'mongoose';
import { COUPON_TYPES } from '@sakthimaan/shared';
import { integerValidator } from './common.schemas.js';
import { softDeleteFields, softDeletePlugin } from './plugins/soft-delete.plugin.js';

/**
 * Coupons and offers. An offer with `autoApply: true` needs no code: it applies
 * automatically inside its validity window (used for early-bird offers).
 */
const couponSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    type: { type: String, enum: COUPON_TYPES, required: true },
    value: { type: Number, required: true, min: 0 }, // paise for flat, % for percent
    maxDiscount: { type: Number, min: 0, validate: integerValidator }, // cap for percent coupons
    minOrderValue: { type: Number, default: 0, min: 0, validate: integerValidator },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    usageLimit: { type: Number, min: 1 }, // total redemptions; unset = unlimited
    perCustomerLimit: { type: Number, min: 1, default: 1 },
    usedCount: { type: Number, default: 0, required: true },
    autoApply: { type: Boolean, default: false, required: true },
    isEarlyBird: { type: Boolean, default: false, required: true },
    applicableCategories: { type: [Schema.Types.ObjectId], ref: 'Category', default: [] }, // empty = all
    isActive: { type: Boolean, default: true, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...softDeleteFields,
  },
  { timestamps: true },
);

couponSchema.plugin(softDeletePlugin);
couponSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
couponSchema.index({ isActive: 1, validFrom: 1, validTo: 1 });
couponSchema.index({ autoApply: 1, isActive: 1, validTo: 1 });

export type Coupon = InferSchemaType<typeof couponSchema>;
export const CouponModel = model('Coupon', couponSchema);
