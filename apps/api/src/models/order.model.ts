import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  DELIVERY_CHARGE_MODES,
  INDIAN_STATE_CODES,
  NET_PRICE_ROUNDING_MODES,
  ORDER_MODES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PRODUCT_TYPES,
  PRODUCT_UNITS,
} from '@sakthimaan/shared';
import { GSTIN_REGEX, MOBILE_REGEX, addressSchema, integerValidator } from './common.schemas.js';
import { softDeleteFields, softDeletePlugin } from './plugins/soft-delete.plugin.js';

const paise = { type: Number, required: true, validate: integerValidator } as const;
const taxParts = {
  taxableValue: paise,
  cgst: { ...paise, default: 0 },
  sgst: { ...paise, default: 0 },
  igst: { ...paise, default: 0 },
} as const;

/**
 * Line items are full snapshots taken when the line is added or edited. Nothing on
 * an order line is ever re-read from the product: editing, deleting or re-using a
 * product's SKU cannot change an existing order or its invoice. `product` is kept
 * only as a link for reports and the "view product" button.
 */
const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: PRODUCT_TYPES, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryName: { type: String, required: true },
    unit: { type: String, enum: PRODUCT_UNITS, required: true },
    contentsCount: { type: Number, default: 1 },
    isGreen: { type: Boolean, default: false },
    hsn: { type: String, required: true },
    taxRate: { type: Number, required: true, min: 0, max: 28 },
    mrp: paise, // per unit
    discountPct: { type: Number, required: true, min: 0, max: 100 },
    netPrice: paise, // per unit, GST-inclusive, after rounding
    qty: { type: Number, required: true, min: 1, validate: integerValidator },
    lineMrpTotal: paise,
    lineTotal: paise, // netPrice × qty
    couponShare: { ...paise, default: 0 },
    ...taxParts, // back-calculated from (lineTotal − couponShare)
    comboContents: {
      type: [{ _id: false, sku: String, name: String, qty: Number }],
      default: [],
    },
  },
  { _id: true },
);

const orderSchema = new Schema(
  {
    orderNo: { type: String, required: true }, // e.g. ORD/26-27/000123 (counter-based)
    status: { type: String, enum: ORDER_STATUSES, default: 'enquiry', required: true },
    mode: { type: String, enum: ORDER_MODES, required: true },
    source: { type: String, enum: ORDER_SOURCES, required: true },

    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerSnapshot: {
      name: { type: String, required: true },
      phone: { type: String, required: true, match: MOBILE_REGEX },
      altPhone: { type: String },
      email: { type: String },
      gstin: { type: String, uppercase: true, match: GSTIN_REGEX }, // B2B buyers
    },
    shippingAddress: { type: addressSchema, required: true },
    zoneName: { type: String }, // snapshot of resolved zone at order time

    items: {
      type: [orderItemSchema],
      required: true,
      validate: { validator: (v: unknown[]) => v.length > 0, message: 'Order must have items' },
    },

    // Output of shared `priceOrder()`; recomputed whenever items change (enquiry only),
    // frozen from confirmation onwards. All amounts in paise.
    pricing: {
      mrpTotal: paise,
      productDiscount: paise,
      subtotal: paise,
      couponCode: { type: String },
      couponDiscount: { ...paise, default: 0 },
      deliveryCharge: { ...paise, default: 0 },
      deliveryChargeMode: { type: String, enum: DELIVERY_CHARGE_MODES, default: 'to_pay' },
      packingCharge: { ...paise, default: 0 },
      charges: {
        hsn: { type: String },
        taxRate: { type: Number },
        taxableValue: { type: Number, default: 0 },
        cgst: { type: Number, default: 0 },
        sgst: { type: Number, default: 0 },
        igst: { type: Number, default: 0 },
      },
      ...taxParts,
      totalTax: paise,
      grossTotal: paise,
      roundOff: { ...paise, default: 0 }, // signed
      grandTotal: paise,
      isInterState: { type: Boolean, required: true },
      sellerStateCode: { type: String, enum: INDIAN_STATE_CODES, required: true },
      placeOfSupply: { type: String, enum: INDIAN_STATE_CODES, required: true },
      netPriceRounding: { type: String, enum: NET_PRICE_ROUNDING_MODES },
    },

    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid', required: true },
    amountPaid: { type: Number, default: 0, required: true }, // Σ recorded payments − refunds

    // true once stock has been deducted (confirm); guards against double deduct/restock.
    stockCommitted: { type: Boolean, default: false, required: true },
    // Set when packed before payment under the customer's credit (audited as pack_unpaid).
    packedOnCredit: { type: Boolean, default: false, required: true },

    dispatch: {
      transportPartner: { type: Schema.Types.ObjectId, ref: 'TransportPartner' },
      transportName: { type: String, trim: true },
      lrNumber: { type: String, trim: true, uppercase: true },
      dispatchDate: { type: Date },
      boxes: { type: Number, min: 1 },
      weightKg: { type: Number, min: 0 },
      destination: { type: String, trim: true }, // transport booking city / godown
      trackingUrl: { type: String },
      deliveredAt: { type: Date },
    },

    // Links to the immutable legal documents (see invoice.model / credit-note.model).
    invoice: {
      id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
      number: { type: String },
      issuedAt: { type: Date },
    },
    creditNotes: {
      type: [
        {
          _id: false,
          id: { type: Schema.Types.ObjectId, ref: 'CreditNote', required: true },
          number: { type: String, required: true },
          issuedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },

    customerNotes: { type: String, trim: true, maxlength: 1000 },
    confirmedAt: { type: Date },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true, maxlength: 500 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }, // null for website orders
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...softDeleteFields,
  },
  {
    timestamps: true,
    // Two staff editing the same enquiry over the phone: the second save gets a VersionError (409).
    optimisticConcurrency: true,
  },
);

orderSchema.plugin(softDeletePlugin);

orderSchema.index({ orderNo: 1 }, { unique: true });
orderSchema.index({ status: 1, createdAt: -1, _id: -1 });
orderSchema.index({ status: 1, 'items.product': 1 }); // pending enquiry demand per product
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ 'customerSnapshot.phone': 1, createdAt: -1 });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ 'shippingAddress.stateCode': 1, createdAt: -1 });
orderSchema.index({ createdAt: -1, _id: -1 }); // default list order + cursor pagination
orderSchema.index({ 'dispatch.dispatchDate': -1 }, { sparse: true });
orderSchema.index({ 'dispatch.lrNumber': 1 }, { sparse: true });
orderSchema.index({ 'invoice.number': 1 }, { sparse: true });
orderSchema.index({ 'items.product': 1, createdAt: -1 }); // product-wise reports

export type Order = InferSchemaType<typeof orderSchema>;
export type OrderDocument = HydratedDocument<Order>;
export const OrderModel = model('Order', orderSchema);
