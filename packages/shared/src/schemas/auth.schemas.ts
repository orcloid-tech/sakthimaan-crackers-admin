import { z } from 'zod';
import type { Permission, Role } from '../permissions.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email' }).max(254));

/**
 * Password policy: 10–128 chars with at least one letter and one digit.
 * Length beats complexity rules; 128 caps bcrypt work (bcrypt reads only 72 bytes,
 * so very long passwords are also rejected by byte length).
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => new TextEncoder().encode(v).length <= 72, 'Password is too long')
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'Password must contain a letter and a number');

export const loginSchema = z.strictObject({
  email: emailSchema,
  // Not the policy: existing passwords are only checked, never re-validated.
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const twoFactorVerifySchema = z.strictObject({
  challengeToken: z.string().min(1).max(2000),
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{4,8}$/, 'Enter the verification code'),
});
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

export const forgotPasswordSchema = z.strictObject({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'Invalid reset link'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateMeSchema = z.strictObject({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number')
    .optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Shape of the authenticated user returned by login and GET /auth/me. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  permissions: Permission[];
  lastLoginAt: string | null;
}

export type LoginResult =
  | { twoFactorRequired: false; accessToken: string; expiresIn: number; user: AuthUser }
  | { twoFactorRequired: true; challengeToken: string };

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}
