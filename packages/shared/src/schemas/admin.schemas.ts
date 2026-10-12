import { z } from 'zod';
import { DELIVERY_CHARGE_MODES, DELIVERY_CHARGE_TYPES } from '../enums.js';
import { INDIAN_STATE_CODES } from '../states.js';
import { emailSchema } from './auth.schemas.js';
import { objectIdSchema, pageQuery, paiseSchema, plainText } from './common.schemas.js';
import { addressInputSchema, gstinSchema, mobileSchema } from './order.schemas.js';

// ------------------------------------------------------------------ shipping

export const deliveryRuleSchema = z
  .strictObject({
    minOrderValue: paiseSchema.default(0),
    maxOrderValue: paiseSchema.optional(),
    type: z.enum(DELIVERY_CHARGE_TYPES),
    /** Paise for "flat", percent of the subtotal for "percent", ignored for "free". */
    value: z.number().min(0).default(0),
  })
  .refine((r) => r.maxOrderValue === undefined || r.maxOrderValue > r.minOrderValue, {
    path: ['maxOrderValue'],
    message: 'Must be more than the "from" amount',
  })
  .refine((r) => r.type !== 'percent' || r.value <= 100, { path: ['value'], message: 'At most 100%' })
  .refine((r) => r.type !== 'flat' || Number.isInteger(r.value), { path: ['value'], message: 'Whole paise' });

export const zoneInputSchema = z
  .strictObject({
    name: plainText(80).pipe(z.string().min(2, 'Name the zone')),
    description: plainText(300).optional(),
    minOrderValue: paiseSchema,
    deliveryChargeMode: z.enum(DELIVERY_CHARGE_MODES),
    deliveryRules: z.array(deliveryRuleSchema).max(10).default([]),
    estimatedDeliveryDays: z
      .strictObject({ min: z.number().int().min(0).max(60), max: z.number().int().min(0).max(60) })
      .refine((d) => d.max >= d.min, { path: ['max'], message: 'Must be at least the minimum' })
      .optional(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((z) => z.deliveryChargeMode === 'prepaid' || z.deliveryRules.length === 0, {
    path: ['deliveryRules'],
    message: 'Delivery rules apply only when delivery is prepaid',
  });
export type ZoneInput = z.infer<typeof zoneInputSchema>;

/** Change one or many states at once (e.g. mark all of North India serviceable). */
export const stateUpdateSchema = z
  .strictObject({
    codes: z.array(z.enum(INDIAN_STATE_CODES)).min(1).max(40),
    isServiceable: z.boolean().optional(),
    zoneId: objectIdSchema.nullable().optional(),
    minOrderValue: paiseSchema.nullable().optional(),
    restrictionNote: plainText(300).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type StateUpdateInput = z.infer<typeof stateUpdateSchema>;

export const cityInputSchema = z.strictObject({
  stateCode: z.enum(INDIAN_STATE_CODES),
  name: plainText(100).pipe(z.string().min(2, 'Enter the city')),
  isServiceable: z.boolean(),
  minOrderValue: paiseSchema.nullable().optional(),
  restrictionNote: plainText(300).optional(),
});
export type CityInput = z.infer<typeof cityInputSchema>;

export const transportPartnerInputSchema = z.strictObject({
  name: plainText(100).pipe(z.string().min(2, 'Enter the name')),
  contactPerson: plainText(100).optional(),
  phones: z.array(mobileSchema).max(5).default([]),
  email: emailSchema.optional(),
  trackingUrlTemplate: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\/\S+$/.test(v) && v.includes('{lr}'), 'An http(s) link containing {lr}')
    .optional(),
  servedStates: z.array(z.enum(INDIAN_STATE_CODES)).max(40).default([]),
  notes: plainText(500).optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});
export type TransportPartnerInput = z.infer<typeof transportPartnerInputSchema>;

// ------------------------------------------------------------------ customers

export const CUSTOMER_SORTS = ['recent', 'spend', 'orders', 'name', 'created'] as const;

export const customerListQuery = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum(['all', 'blocked', 'credit']).default('all'),
  stateCode: z.enum(INDIAN_STATE_CODES).optional(),
  sort: z.enum(CUSTOMER_SORTS).default('recent'),
  ...pageQuery,
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;

export const customerAddressInputSchema = z.strictObject({
  label: plainText(40).optional(),
  isDefault: z.boolean().default(false),
  address: addressInputSchema,
});

/** Contact details; `null` clears an optional field. Credit and blocking have their own endpoints. */
export const customerUpdateSchema = z
  .strictObject({
    name: plainText(120).pipe(z.string().min(2, 'Enter the name')).optional(),
    phone: mobileSchema.optional(),
    altPhone: mobileSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
    gstin: gstinSchema.nullable().optional(),
    notes: plainText(2000).nullable().optional(),
    tags: z
      .array(plainText(30).pipe(z.string().min(1)))
      .max(10)
      .optional(),
    addresses: z.array(customerAddressInputSchema).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export const customerBlockSchema = z
  .strictObject({ blocked: z.boolean(), reason: plainText(300).optional() })
  .refine((v) => !v.blocked || (v.reason?.length ?? 0) >= 3, {
    path: ['reason'],
    message: 'Say why the customer is blocked',
  });

export const customerCreditSchema = z.strictObject({
  creditAllowed: z.boolean(),
  reason: plainText(300).optional(),
});
