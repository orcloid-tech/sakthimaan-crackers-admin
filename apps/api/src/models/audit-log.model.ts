import { Schema, model, type InferSchemaType } from 'mongoose';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '@sakthimaan/shared';
import { actorSchema } from './common.schemas.js';

const changeSchema = new Schema(
  {
    path: { type: String, required: true }, // e.g. "discountPct", "status", "stock"
    from: { type: Schema.Types.Mixed },
    to: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

/**
 * Append-only audit trail. Written explicitly by services (not Mongoose hooks),
 * so it always has the acting user, request id and a meaningful diff, and so bulk
 * operations are recorded as one entry with `meta.count`.
 */
const auditLogSchema = new Schema(
  {
    actor: { type: actorSchema }, // absent for system jobs
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    entity: { type: String, enum: AUDIT_ENTITIES, required: true },
    entityId: { type: String }, // string so it can hold ObjectIds and the settings singleton id
    entityLabel: { type: String }, // e.g. SKU or order number, for display
    summary: { type: String, maxlength: 500 },
    changes: { type: [changeSchema], default: [] },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String, maxlength: 500 },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ 'actor.user': 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1, _id: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);
