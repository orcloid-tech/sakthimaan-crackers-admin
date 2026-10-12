import { z } from 'zod';
import { DELIVERY_CHARGE_MODES, ORDER_SOURCES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../enums.js';
import { ORDER_STATUSES } from '../order-workflow.js';
import { INDIAN_STATE_CODES } from '../states.js';
import { emailSchema } from './auth.schemas.js';
import { boolQuery, objectIdSchema, pageQuery, paiseSchema, plainText } from './common.schemas.js';

export const mobileSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=[6-9]\d{9}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN');

export const addressInputSchema = z.strictObject({
  line1: plainText(200).pipe(z.string().min(3, 'Enter the address')),
  line2: plainText(200).optional(),
  landmark: plainText(120).optional(),
  city: plainText(100).pipe(z.string().min(2, 'Enter the city')),
  district: plainText(100).optional(),
  stateCode: z.enum(INDIAN_STATE_CODES, { message: 'Choose a state' }),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit PIN code'),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

export const customerInputSchema = z.strictObject({
  name: plainText(120).pipe(z.string().min(2, 'Enter the name')),
  phone: mobileSchema,
  altPhone: mobileSchema.optional(),
  email: emailSchema.optional(),
  gstin: gstinSchema.optional(),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const orderLineInputSchema = z.strictObject({
  productId: objectIdSchema,
  qty: z.number().int().min(1).max(10_000),
});

const linesSchema = z
  .array(orderLineInputSchema)
  .min(1, 'Add at least one product')
  .max(200)
  .refine((ls) => new Set(ls.map((l) => l.productId)).size === ls.length, 'Each product once per order');

/** Website enquiry / order (public, captcha-protected). Prices are always taken from the catalogue. */
export const publicOrderSchema = z.strictObject({
  customer: customerInputSchema,
  address: addressInputSchema,
  items: linesSchema,
  notes: plainText(1000).optional(),
});
export type PublicOrderInput = z.infer<typeof publicOrderSchema>;

export const pricingPreviewSchema = z.strictObject({
  stateCode: z.enum(INDIAN_STATE_CODES),
  city: plainText(100).optional(),
  items: linesSchema,
  deliveryCharge: paiseSchema.optional(),
});
export type PricingPreviewInput = z.infer<typeof pricingPreviewSchema>;

/** Order taken by staff over the phone / WhatsApp. */
export const adminOrderCreateSchema = z.strictObject({
  customer: customerInputSchema,
  address: addressInputSchema,
  items: linesSchema,
  source: z.enum(ORDER_SOURCES).default('phone'),
  notes: plainText(1000).optional(),
  deliveryCharge: paiseSchema.optional(),
  deliveryChargeMode: z.enum(DELIVERY_CHARGE_MODES).optional(),
});
export type AdminOrderCreateInput = z.infer<typeof adminOrderCreateSchema>;

/** Edits while the order is still an enquiry. `version` = the order version shown. */
export const orderUpdateSchema = z
  .strictObject({
    version: z.number().int().min(0),
    items: linesSchema.optional(),
    address: addressInputSchema.optional(),
    customer: customerInputSchema.omit({ phone: true }).partial().optional(),
    notes: plainText(1000).optional(),
    deliveryCharge: paiseSchema.optional(),
    deliveryChargeMode: z.enum(DELIVERY_CHARGE_MODES).optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export const transitionSchema = z.strictObject({
  to: z.enum(ORDER_STATUSES),
  version: z.number().int().min(0),
  reason: plainText(500).optional(),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const commentSchema = z.strictObject({
  message: plainText(2000).pipe(z.string().min(1, 'Write something')),
  isInternal: z.boolean().default(true),
});
export type CommentInput = z.infer<typeof commentSchema>;

/** Multipart form fields (strings) for recording a payment; screenshot is the optional file. */
export const paymentCreateSchema = z.object({
  amount: z.coerce.number().int('Whole paise').min(1, 'Enter the amount'),
  method: z.enum(PAYMENT_METHODS),
  reference: plainText(100).optional(),
  paidAt: z.coerce.date(),
  notes: plainText(500).optional(),
  kind: z.enum(['payment', 'refund']).default('payment'),
});
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

export const paymentVoidSchema = z.strictObject({
  reason: plainText(300).pipe(z.string().min(3, 'Say why')),
});

export const dispatchSchema = z.strictObject({
  transportPartnerId: objectIdSchema.nullable().optional(),
  transportName: plainText(100).pipe(z.string().min(2, 'Enter the transport name')),
  lrNumber: plainText(60).pipe(z.string().min(2, 'Enter the LR number')),
  dispatchDate: z.coerce.date(),
  boxes: z.number().int().min(1).max(1000),
  weightKg: z.number().min(0).max(100_000).optional(),
  destination: plainText(100).optional(),
});
export type DispatchInput = z.infer<typeof dispatchSchema>;

export const orderListQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  stateCode: z.enum(INDIAN_STATE_CODES).optional(),
  customerId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Order number, phone (any part), customer name or LR number. */
  q: z.string().trim().max(60).optional(),
  ...pageQuery,
});
export type OrderListQuery = z.infer<typeof orderListQuery>;

export const whatsappQuery = z.object({
  event: z.enum([
    'order_received',
    'order_confirmed',
    'payment_reminder',
    'payment_received',
    'order_packed',
    'order_dispatched',
    'order_delivered',
    'order_cancelled',
  ]),
});
export type WhatsAppEvent = z.infer<typeof whatsappQuery>['event'];

export const publicTrackQuery = z.object({ phone: mobileSchema });

export const dashboardQuery = z.object({
  days: z.coerce.number().int().min(7).max(120).default(30),
  refresh: boolQuery.optional(),
});
