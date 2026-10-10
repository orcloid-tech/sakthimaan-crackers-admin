import { Schema } from 'mongoose';
import { INDIAN_STATE_CODES, PRODUCT_UNITS } from '@sakthimaan/shared';
import { actorSchema, addressSchema } from './common.schemas.js';

/**
 * Building blocks shared by Invoice and CreditNote. Both are complete, self-contained
 * snapshots: seller details (GSTIN, licence), buyer, lines and tax totals are copied at
 * issue time, so reprinting a document years later gives exactly the same output even
 * if the company profile, products or the order have changed since.
 */

const n = { type: Number, required: true } as const;

export const docPartySellerSchema = new Schema(
  {
    name: { type: String, required: true },
    legalName: { type: String },
    gstin: { type: String },
    licenseNumber: { type: String },
    address: { type: addressSchema },
    phone: { type: String },
    email: { type: String },
    stateCode: { type: String, enum: INDIAN_STATE_CODES, required: true },
    gstStateCode: { type: String, required: true },
  },
  { _id: false },
);

export const docPartyBuyerSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    gstin: { type: String },
    address: { type: addressSchema, required: true },
  },
  { _id: false },
);

export const docLineSchema = new Schema(
  {
    sku: { type: String, required: true },
    name: { type: String, required: true },
    hsn: { type: String, required: true },
    unit: { type: String, enum: PRODUCT_UNITS, required: true },
    qty: n,
    mrp: n,
    discountPct: n,
    netPrice: n,
    lineTotal: n,
    couponShare: { type: Number, default: 0 },
    taxRate: n,
    taxableValue: n,
    cgst: n,
    sgst: n,
    igst: n,
  },
  { _id: false },
);

export const docHsnSummarySchema = new Schema(
  { hsn: { type: String, required: true }, taxRate: n, taxableValue: n, cgst: n, sgst: n, igst: n },
  { _id: false },
);

export const docTotalsSchema = new Schema(
  {
    mrpTotal: n,
    productDiscount: n,
    subtotal: n,
    couponDiscount: n,
    deliveryCharge: n,
    packingCharge: n,
    taxableValue: n,
    cgst: n,
    sgst: n,
    igst: n,
    totalTax: n,
    grossTotal: n,
    roundOff: n, // printed as the "Round off" line
    grandTotal: n,
    amountInWords: { type: String, required: true },
  },
  { _id: false },
);

/** Fields common to invoices and credit notes. */
export const taxDocumentFields = {
  number: { type: String, required: true }, // ≤ 16 chars, see shared/document-number
  financialYear: { type: String, required: true }, // "26-27"
  seq: { type: Number, required: true },
  issuedAt: { type: Date, required: true },
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  orderNo: { type: String, required: true },
  seller: { type: docPartySellerSchema, required: true },
  buyer: { type: docPartyBuyerSchema, required: true },
  placeOfSupply: { type: String, enum: INDIAN_STATE_CODES, required: true },
  isInterState: { type: Boolean, required: true },
  items: { type: [docLineSchema], required: true },
  hsnSummary: { type: [docHsnSummarySchema], required: true },
  totals: { type: docTotalsSchema, required: true },
  issuedBy: { type: actorSchema, required: true },
} as const;
