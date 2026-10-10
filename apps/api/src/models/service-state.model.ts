import { Schema, model, type InferSchemaType } from 'mongoose';
import { INDIAN_STATE_CODES } from '@sakthimaan/shared';
import { integerValidator } from './common.schemas.js';

/** Per-state serviceability. Seeded with all states/UTs; admins toggle and assign zones. */
const serviceStateSchema = new Schema(
  {
    code: { type: String, enum: INDIAN_STATE_CODES, required: true },
    name: { type: String, required: true },
    gstCode: { type: String, required: true, match: /^[0-9]{2}$/ },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },
    isServiceable: { type: Boolean, default: false, required: true },
    minOrderValue: { type: Number, min: 0, default: null, validate: integerValidator }, // override
    restrictionNote: { type: String, trim: true, maxlength: 300 }, // shown when not serviceable
  },
  { timestamps: true, collection: 'states' },
);

serviceStateSchema.index({ code: 1 }, { unique: true });
serviceStateSchema.index({ zone: 1 });
serviceStateSchema.index({ isServiceable: 1 });

export type ServiceState = InferSchemaType<typeof serviceStateSchema>;
export const ServiceStateModel = model('ServiceState', serviceStateSchema);
