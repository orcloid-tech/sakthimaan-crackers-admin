import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../enums.js';
import { objectIdSchema, pageQuery } from './common.schemas.js';

/** Calendar day in IST, e.g. 2026-04-01. Reports and filters work in whole IST days. */
export const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00+05:30`)), 'Not a real date');

export const REPORT_KINDS = ['sales', 'products', 'states', 'gst', 'payments', 'dispatch', 'stock'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** `from`/`to` default to the current financial year to date (April–March, IST). */
export const reportQuery = z
  .object({
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
    format: z.enum(['json', 'xlsx']).default('json'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'End date is before the start date',
  });
export type ReportQuery = z.infer<typeof reportQuery>;

export const reportParams = z.strictObject({ kind: z.enum(REPORT_KINDS) });

export const auditListQuery = z
  .object({
    userId: objectIdSchema.optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    entity: z.enum(AUDIT_ENTITIES).optional(),
    entityId: z.string().trim().max(64).optional(),
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
    /** Matches the record label (SKU, order no.) or the summary. */
    q: z.string().trim().max(60).optional(),
    ...pageQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'End date is before the start date',
  });
export type AuditListQuery = z.infer<typeof auditListQuery>;
