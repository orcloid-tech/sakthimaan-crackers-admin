import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { GSTIN_REGEX, MOBILE_REGEX, addressSchema } from './common.schemas.js';
import { softDeleteFields, softDeletePlugin } from './plugins/soft-delete.plugin.js';

const customerAddressSchema = new Schema({
  label: { type: String, trim: true, maxlength: 40 }, // Home, Shop, ...
  isDefault: { type: Boolean, default: false },
  address: { type: addressSchema, required: true },
});

/** Customers are identified by mobile number (the primary channel in this business). */
const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, match: MOBILE_REGEX },
    altPhone: { type: String, match: MOBILE_REGEX },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    addresses: { type: [customerAddressSchema], default: [] },
    gstin: { type: String, trim: true, uppercase: true, match: GSTIN_REGEX }, // B2B buyers
    notes: { type: String, trim: true, maxlength: 2000 },

    // Trusted customer: orders may be packed before payment by a user holding
    // orders:pack_unpaid. Toggling requires customers:credit and is audited.
    creditAllowed: { type: Boolean, default: false, required: true },
    tags: { type: [String], default: [] }, // e.g. "wholesale", "repeat"

    isBlocked: { type: Boolean, default: false, required: true },
    blockedReason: { type: String, trim: true, maxlength: 300 },
    blockedAt: { type: Date },
    blockedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // Denormalised stats, updated in the order service on confirm/cancel/payment.
    stats: {
      orderCount: { type: Number, default: 0, required: true },
      totalSpent: { type: Number, default: 0, required: true }, // paise, from recorded payments
      lastOrderAt: { type: Date },
    },
    ...softDeleteFields,
  },
  { timestamps: true },
);

customerSchema.plugin(softDeletePlugin);
customerSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
customerSchema.index({ email: 1 }, { sparse: true });
customerSchema.index({ 'stats.totalSpent': -1 });
customerSchema.index({ 'stats.lastOrderAt': -1 });
customerSchema.index({ isBlocked: 1 });
customerSchema.index({ creditAllowed: 1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ name: 'text', phone: 'text', email: 'text' }, { name: 'customer_text' });

export type Customer = InferSchemaType<typeof customerSchema>;
export type CustomerDocument = HydratedDocument<Customer>;
export const CustomerModel = model('Customer', customerSchema);
