import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES } from '@sakthimaan/shared';
import { MOBILE_REGEX } from './common.schemas.js';
import { softDeleteFields, softDeletePlugin } from './plugins/soft-delete.plugin.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, match: MOBILE_REGEX },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, default: true, required: true },

    // Lockout: after N failed attempts lockUntil is set (N and duration come from config).
    failedLoginAttempts: { type: Number, default: 0, required: true },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },

    // Bumping tokenVersion invalidates every outstanding access/refresh token for the user.
    tokenVersion: { type: Number, default: 0, required: true },
    passwordChangedAt: { type: Date },
    passwordReset: {
      tokenHash: { type: String, select: false },
      expiresAt: { type: Date },
    },

    // Optional 2FA hook; the provider (TOTP / email OTP / SMS OTP) is pluggable.
    twoFactor: {
      enabled: { type: Boolean, default: false, required: true },
      method: { type: String, enum: ['totp', 'email_otp', 'sms_otp'] },
      secretEncrypted: { type: String, select: false },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...softDeleteFields,
  },
  { timestamps: true },
);

userSchema.plugin(softDeletePlugin);
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ 'passwordReset.tokenHash': 1 }, { sparse: true });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
