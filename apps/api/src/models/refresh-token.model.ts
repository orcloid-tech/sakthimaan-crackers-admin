import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Refresh tokens are opaque random strings; only a SHA-256 hash is stored.
 * Rotation: each refresh issues a new token in the same `familyId` and revokes
 * the old one. Presenting an already-revoked token means reuse, so the whole family is revoked.
 */
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    tokenVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    createdByIp: { type: String },
    userAgent: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ user: 1, revokedAt: 1 });
refreshTokenSchema.index({ familyId: 1 });
// TTL: MongoDB removes documents once expiresAt has passed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);
