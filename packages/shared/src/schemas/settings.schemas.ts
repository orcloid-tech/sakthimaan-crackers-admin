import { z } from 'zod';
import { ORDER_MODES, PAYMENT_METHODS } from '../enums.js';
import { validateDocumentNumberFormat } from '../document-number.js';
import { HSN_REGEX } from '../tax.js';
import { NET_PRICE_ROUNDING_MODES } from '../money.js';
import { INDIAN_STATE_CODES } from '../states.js';
import { emailSchema } from './auth.schemas.js';
import { httpUrlSchema, paiseSchema, plainText, taxRateSchema } from './common.schemas.js';
import { addressInputSchema, gstinSchema, mobileSchema, whatsappQuery } from './order.schemas.js';

/**
 * Settings are edited one section at a time. Each section replaces the stored section
 * as a whole (a field left out is cleared), and the request carries the settings
 * `version` shown on screen so two people editing at once don't overwrite each other.
 */

const optionalText = (max: number) => plainText(max).optional();

export const companySettingsSchema = z.strictObject({
  name: plainText(120).pipe(z.string().min(2, 'Enter the store name')),
  legalName: optionalText(160),
  address: addressInputSchema.optional(),
  phones: z.array(mobileSchema).max(5).default([]),
  whatsappNumber: mobileSchema.optional(),
  email: emailSchema.optional(),
  gstin: gstinSchema.optional(),
  licenseNumber: optionalText(60),
  licenseValidTill: z.coerce.date().optional(),
});

export const storefrontSettingsSchema = z.strictObject({
  isOpen: z.boolean(),
  closedMessage: optionalText(500),
  orderMode: z.enum(ORDER_MODES),
  /** Shown to the customer after submitting on the website. */
  messages: z
    .strictObject({ enquiryReceived: optionalText(500), checkoutConfirmed: optionalText(500) })
    .default({}),
  announcement: z
    .strictObject({
      text: optionalText(300),
      linkUrl: httpUrlSchema.optional(),
      isActive: z.boolean().default(false),
    })
    .default({ isActive: false }),
});

export const taxSettingsSchema = z.strictObject({
  sellerStateCode: z.enum(INDIAN_STATE_CODES).optional(),
  defaultHsn: z.string().trim().regex(HSN_REGEX, 'HSN must be 4, 6 or 8 digits').optional(),
  defaultTaxRate: taxRateSchema.optional(),
  netPriceRounding: z.enum(NET_PRICE_ROUNDING_MODES),
});

const prefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,10}$/, '1–10 letters or digits');

export const invoiceSettingsSchema = z
  .strictObject({
    prefix: prefixSchema.optional(),
    creditNotePrefix: prefixSchema,
    format: z.string().trim().max(40),
    creditNoteFormat: z.string().trim().max(40),
    terms: optionalText(2000),
    footerNote: optionalText(500),
    showUpiQr: z.boolean(),
  })
  .superRefine((v, ctx) => {
    for (const msg of v.prefix ? validateDocumentNumberFormat(v.format, v.prefix) : []) {
      ctx.addIssue({ code: 'custom', path: ['format'], message: msg });
    }
    for (const msg of validateDocumentNumberFormat(v.creditNoteFormat, v.creditNotePrefix)) {
      ctx.addIssue({ code: 'custom', path: ['creditNoteFormat'], message: msg });
    }
  });

export const paymentSettingsSchema = z.strictObject({
  upiId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'Enter a UPI ID like name@bank')
    .optional(),
  upiPayeeName: optionalText(100),
  showUpiQrOnStorefront: z.boolean(),
  /** Ways customers can pay; staff record only these. */
  acceptedMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, 'Accept at least one payment method').max(3),
  bank: z
    .strictObject({
      accountName: plainText(120).pipe(z.string().min(2, 'Enter the account name')),
      accountNumber: z
        .string()
        .trim()
        .regex(/^\d{6,20}$/, '6–20 digits'),
      ifsc: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter an 11-character IFSC'),
      bankName: plainText(120).pipe(z.string().min(2, 'Enter the bank name')),
      branch: optionalText(120),
    })
    .optional(),
  instructions: optionalText(1000),
});

export const orderSettingsSchema = z.strictObject({
  numberPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, '1–6 letters or digits'),
  defaultMinOrderValue: paiseSchema,
  packingChargePct: z.number().min(0).max(20),
  autoCancelUnpaidCheckoutHours: z.number().int().min(1).max(720),
  defaultLowStockThreshold: z.number().int().min(0).max(100_000),
});

/** Notes printed on documents (empty = not printed). */
export const documentsSettingsSchema = z.strictObject({
  priceListNote: optionalText(500),
  priceListFooter: optionalText(500),
  packingSlipNote: optionalText(500),
});

export const WHATSAPP_EVENTS = whatsappQuery.shape.event.options;

/** Event → message. An empty string removes the message (its WhatsApp button is then disabled). */
export const whatsappTemplatesSchema = z.partialRecord(z.enum(WHATSAPP_EVENTS), z.string().trim().max(1000));

export const settingsUpdateSchema = z
  .strictObject({
    version: z.number().int().min(0),
    company: companySettingsSchema.optional(),
    storefront: storefrontSettingsSchema.optional(),
    tax: taxSettingsSchema.optional(),
    invoice: invoiceSettingsSchema.optional(),
    payment: paymentSettingsSchema.optional(),
    order: orderSettingsSchema.optional(),
    whatsappTemplates: whatsappTemplatesSchema.optional(),
    documents: documentsSettingsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
export type SettingsSection = Exclude<keyof SettingsUpdateInput, 'version'>;

export const seasonSchema = z
  .strictObject({
    name: plainText(60).pipe(z.string().min(3, 'Name the season')),
    festivalDate: z.coerce.date(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((s) => s.startDate < s.endDate, { path: ['endDate'], message: 'End must be after start' })
  .refine((s) => s.festivalDate >= s.startDate && s.festivalDate <= s.endDate, {
    path: ['festivalDate'],
    message: 'Festival date must be within the season',
  });
export type SeasonInput = z.infer<typeof seasonSchema>;
