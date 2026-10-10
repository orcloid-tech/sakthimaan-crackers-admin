import { Schema, model, type InferSchemaType } from 'mongoose';
import { INDIAN_STATE_CODES } from '@sakthimaan/shared';
import { MOBILE_REGEX } from './common.schemas.js';

/** Parcel/transport services used for dispatch (e.g. KPN, ST Courier, local lorry services). */
const transportPartnerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    contactPerson: { type: String, trim: true, maxlength: 100 },
    phones: {
      type: [{ type: String, match: MOBILE_REGEX }],
      default: [],
    },
    email: { type: String, trim: true, lowercase: true },
    // e.g. "https://example.com/track?lr={lr}"; {lr} is replaced with the LR number.
    trackingUrlTemplate: { type: String, trim: true, maxlength: 500 },
    servedStates: { type: [{ type: String, enum: INDIAN_STATE_CODES }], default: [] },
    notes: { type: String, trim: true, maxlength: 500 },
    sortOrder: { type: Number, default: 0, required: true },
    isActive: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);

transportPartnerSchema.index({ name: 1 }, { unique: true });
transportPartnerSchema.index({ isActive: 1, sortOrder: 1 });

export type TransportPartner = InferSchemaType<typeof transportPartnerSchema>;
export const TransportPartnerModel = model('TransportPartner', transportPartnerSchema);
