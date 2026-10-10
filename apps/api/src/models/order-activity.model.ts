import { Schema, model, type InferSchemaType } from 'mongoose';
import { ORDER_ACTIVITY_TYPES, ORDER_STATUSES } from '@sakthimaan/shared';
import { actorSchema } from './common.schemas.js';

/**
 * Order timeline: status changes, edits, payments, notes and internal comments.
 * Kept in its own collection (not embedded) so comments don't contend with the
 * order document's optimistic-concurrency version and the timeline can be paginated.
 */
const orderActivitySchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    type: { type: String, enum: ORDER_ACTIVITY_TYPES, required: true },
    fromStatus: { type: String, enum: ORDER_STATUSES },
    toStatus: { type: String, enum: ORDER_STATUSES },
    message: { type: String, trim: true, maxlength: 2000 },
    meta: { type: Schema.Types.Mixed }, // e.g. item diff, payment id, notification result
    isInternal: { type: Boolean, default: false, required: true },
    actor: { type: actorSchema }, // absent for system/storefront events
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

orderActivitySchema.index({ order: 1, createdAt: -1 });

export type OrderActivity = InferSchemaType<typeof orderActivitySchema>;
export const OrderActivityModel = model('OrderActivity', orderActivitySchema);
