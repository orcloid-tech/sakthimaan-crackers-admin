import { Schema } from 'mongoose';
import { INDIAN_STATE_CODES, STORAGE_PROVIDERS } from '@sakthimaan/shared';

/** Reference to a stored file (Cloudinary/S3). `key` is the provider object id/public id. */
export const imageSchema = new Schema(
  {
    provider: { type: String, enum: STORAGE_PROVIDERS, required: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    bytes: { type: Number },
    mimeType: { type: String },
    alt: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false },
);

export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
/** Indian mobile number, normalised to 10 digits (no +91). */
export const MOBILE_REGEX = /^[6-9][0-9]{9}$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const addressSchema = new Schema(
  {
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    landmark: { type: String, trim: true, maxlength: 120 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    district: { type: String, trim: true, maxlength: 100 },
    stateCode: { type: String, enum: INDIAN_STATE_CODES, required: true },
    pincode: { type: String, required: true, match: PINCODE_REGEX },
  },
  { _id: false },
);

/** Denormalised "who did it" snapshot, so history survives user renames/deletes. */
export const actorSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    role: { type: String },
  },
  { _id: false },
);

export const integerValidator = {
  // Empty optional values (null/undefined) are allowed; `required` handles presence.
  validator: (v: unknown) => v === null || v === undefined || Number.isInteger(v),
  message: '{PATH} must be an integer',
};
