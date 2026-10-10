import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  DEFAULT_CREDIT_NOTE_FORMAT,
  DEFAULT_HSN,
  DEFAULT_INVOICE_FORMAT,
  DEFAULT_INVOICE_PREFIX,
  DEFAULT_NET_PRICE_ROUNDING,
  DEFAULT_SELLER_STATE_CODE,
  DEFAULT_TAX_RATE,
  HSN_REGEX,
  INDIAN_STATE_CODES,
  NET_PRICE_ROUNDING_MODES,
  NOTIFICATION_CHANNELS,
  ORDER_MODES,
} from '@sakthimaan/shared';
import { GSTIN_REGEX, MOBILE_REGEX, addressSchema, imageSchema } from './common.schemas.js';

export const SETTINGS_ID = 'store';

/**
 * Singleton store configuration (`_id: "store"`). Read through a cached settings
 * service; every update is audited with a field-level diff. Numbering formats are
 * validated with shared `validateDocumentNumberFormat()` (≤ 16 chars) before saving.
 */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_ID },

    company: {
      name: { type: String, required: true, trim: true },
      legalName: { type: String, trim: true },
      logo: { type: imageSchema },
      address: { type: addressSchema },
      phones: { type: [{ type: String, match: MOBILE_REGEX }], default: [] },
      whatsappNumber: { type: String, match: MOBILE_REGEX },
      email: { type: String, trim: true, lowercase: true },
      gstin: { type: String, uppercase: true, match: GSTIN_REGEX },
      licenseNumber: { type: String, trim: true }, // explosives licence no., printed on invoices
      licenseValidTill: { type: Date },
    },

    storefront: {
      isOpen: { type: Boolean, default: true, required: true },
      closedMessage: { type: String, maxlength: 500 },
      orderMode: { type: String, enum: ORDER_MODES, default: 'enquiry', required: true },
      announcement: {
        text: { type: String, maxlength: 300 },
        linkUrl: { type: String, maxlength: 500 },
        isActive: { type: Boolean, default: false },
      },
      safetyPageSlug: { type: String, default: 'safety-instructions' },
    },

    // Prices are always GST-inclusive; taxable value is back-calculated.
    tax: {
      sellerStateCode: { type: String, enum: INDIAN_STATE_CODES, default: DEFAULT_SELLER_STATE_CODE, required: true },
      defaultHsn: { type: String, match: HSN_REGEX, default: DEFAULT_HSN, required: true },
      defaultTaxRate: { type: Number, min: 0, max: 28, default: DEFAULT_TAX_RATE, required: true },
    },

    pricing: {
      netPriceRounding: {
        type: String,
        enum: NET_PRICE_ROUNDING_MODES,
        default: DEFAULT_NET_PRICE_ROUNDING,
        required: true,
      },
    },

    invoice: {
      // Tokens: {PREFIX} {FY} {SEQ:n}. Numbers restart every financial year (April–March).
      prefix: { type: String, default: DEFAULT_INVOICE_PREFIX, required: true },
      format: { type: String, default: DEFAULT_INVOICE_FORMAT, required: true }, // SMC/26-27/00042
      creditNoteFormat: { type: String, default: DEFAULT_CREDIT_NOTE_FORMAT, required: true }, // SMC/CN/26-27/001
      terms: { type: String, maxlength: 2000 },
      footerNote: { type: String, maxlength: 500 },
      showUpiQr: { type: Boolean, default: true, required: true },
    },

    // Manual payments (no gateway): shown on the storefront, invoices and WhatsApp messages.
    payment: {
      upiId: { type: String, trim: true, match: /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/ },
      upiPayeeName: { type: String, trim: true, maxlength: 100 },
      upiQrImage: { type: imageSchema }, // optional uploaded QR; otherwise generated from upiId
      showUpiQrOnStorefront: { type: Boolean, default: true, required: true },
      bank: {
        accountName: { type: String, trim: true },
        accountNumber: { type: String, trim: true },
        ifsc: { type: String, trim: true, uppercase: true, match: /^[A-Z]{4}0[A-Z0-9]{6}$/ },
        bankName: { type: String, trim: true },
        branch: { type: String, trim: true },
      },
      instructions: { type: String, maxlength: 1000 },
    },

    order: {
      numberPrefix: { type: String, default: 'ORD', required: true },
      defaultMinOrderValue: { type: Number, default: 300_000, required: true }, // paise (₹3,000)
      // Checkout-mode orders (stock committed at placement) unpaid after this long are cancelled.
      autoCancelUnpaidCheckoutHours: { type: Number, default: 48, min: 1, required: true },
      packingChargePct: { type: Number, default: 0, min: 0, max: 20 },
    },

    inventory: {
      defaultLowStockThreshold: { type: Number, default: 10, required: true },
      batchTrackingEnabled: { type: Boolean, default: false, required: true },
    },

    notifications: {
      // No provider yet: staff use generated wa.me links. Provider channels plug in later.
      enabledChannels: { type: [{ type: String, enum: NOTIFICATION_CHANNELS }], default: [] },
      adminAlertEmails: { type: [String], default: [] },
    },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true },
);

export type Settings = InferSchemaType<typeof settingsSchema>;
export const SettingsModel = model('Settings', settingsSchema);
