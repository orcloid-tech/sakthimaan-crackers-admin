import { Schema, model, type InferSchemaType } from 'mongoose';
import { DELIVERY_CHARGE_MODES, DELIVERY_CHARGE_TYPES } from '@sakthimaan/shared';
import { integerValidator } from './common.schemas.js';

/**
 * Delivery rule bands, evaluated in order: the first band whose
 * [minOrderValue, maxOrderValue) contains the order subtotal decides the charge.
 */
const deliveryRuleSchema = new Schema(
  {
    minOrderValue: { type: Number, default: 0, min: 0, validate: integerValidator },
    maxOrderValue: { type: Number, min: 0, validate: integerValidator }, // unset = no upper bound
    type: { type: String, enum: DELIVERY_CHARGE_TYPES, required: true },
    value: { type: Number, default: 0, min: 0 }, // paise for flat, % for percent
  },
  { _id: false },
);

/**
 * A zone groups states (e.g. "Tamil Nadu", "South India", "North India") that share a
 * minimum order value and delivery rules. Minimum order resolution order:
 * city override, then state override, then zone, then store default (settings).
 */
const zoneSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },
    minOrderValue: { type: Number, required: true, min: 0, validate: integerValidator },
    deliveryChargeMode: { type: String, enum: DELIVERY_CHARGE_MODES, default: 'to_pay', required: true },
    deliveryRules: { type: [deliveryRuleSchema], default: [] },
    estimatedDeliveryDays: {
      min: { type: Number, min: 0 },
      max: { type: Number, min: 0 },
    },
    sortOrder: { type: Number, default: 0, required: true },
    isActive: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);

zoneSchema.index({ name: 1 }, { unique: true });
zoneSchema.index({ isActive: 1, sortOrder: 1 });

export type Zone = InferSchemaType<typeof zoneSchema>;
export const ZoneModel = model('Zone', zoneSchema);
