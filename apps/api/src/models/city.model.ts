import { Schema, model, type InferSchemaType } from 'mongoose';
import { INDIAN_STATE_CODES } from '@sakthimaan/shared';
import { integerValidator } from './common.schemas.js';

/**
 * City-level exceptions only: cities not listed inherit their state's settings.
 * Typical use: block a city where crackers are banned, or raise its minimum order.
 */
const citySchema = new Schema(
  {
    stateCode: { type: String, enum: INDIAN_STATE_CODES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameKey: { type: String, required: true, lowercase: true, trim: true }, // normalised for matching
    isServiceable: { type: Boolean, required: true },
    minOrderValue: { type: Number, min: 0, default: null, validate: integerValidator },
    restrictionNote: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

citySchema.pre('validate', function () {
  this.nameKey = this.name.trim().toLowerCase().replace(/\s+/g, ' ');
});

citySchema.index({ stateCode: 1, nameKey: 1 }, { unique: true });

export type City = InferSchemaType<typeof citySchema>;
export const CityModel = model('City', citySchema);
