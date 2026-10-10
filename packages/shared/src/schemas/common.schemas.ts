import { z } from 'zod';
import { MAX_AMOUNT_PAISE } from '../money.js';
import { HSN_REGEX } from '../tax.js';

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** Amount in integer paise (₹1 = 100). */
export const paiseSchema = z
  .number({ message: 'Must be a number (paise)' })
  .int('Must be whole paise')
  .min(0)
  .max(MAX_AMOUNT_PAISE);

const hasAtMost2Decimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

/** Percentage 0–100 with at most 2 decimals (e.g. 82.5). */
export const percentSchema = z
  .number({ message: 'Must be a number' })
  .min(0)
  .max(100)
  .refine(hasAtMost2Decimals, 'At most 2 decimal places');

export const hsnSchema = z.string().trim().regex(HSN_REGEX, 'HSN must be 4, 6 or 8 digits');
export const taxRateSchema = z.number().min(0).max(28).refine(hasAtMost2Decimals, 'At most 2 decimal places');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
  .max(170);

/** Plain text: trims, and rejects control characters and angle-bracket markup. */
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/.test(v), 'Contains invalid characters');

export const httpUrlSchema = z.url({ protocol: /^https?$/, message: 'Must be an http(s) URL' }).max(500);

/** Query-string booleans: `true`/`false`/`1`/`0`. */
export const boolQuery = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const cursorQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

export const reorderSchema = z.strictObject({
  items: z
    .array(z.strictObject({ id: objectIdSchema, sortOrder: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(2000),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

export const idParams = z.strictObject({ id: objectIdSchema });
