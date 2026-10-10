import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  COMBO_STOCK_MODES,
  HSN_REGEX,
  MAX_AMOUNT_PAISE,
  PRODUCT_TYPES,
  PRODUCT_UNITS,
  SOUND_LEVELS,
  computeNetPrice,
} from '@sakthimaan/shared';
import { imageSchema, integerValidator } from './common.schemas.js';
import { pricingContext } from './pricing-context.js';
import { softDeleteFields, softDeletePlugin } from './plugins/soft-delete.plugin.js';

const comboItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    qty: { type: Number, required: true, min: 1, validate: integerValidator },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 170 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    type: { type: String, enum: PRODUCT_TYPES, default: 'single', required: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    subCategory: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    description: { type: String, trim: true, maxlength: 5000 },
    tags: { type: [String], default: [] },

    // Pricing in paise, GST-inclusive. netPrice is derived from mrp + discountPct using the
    // configured rounding mode, and stored for sorting/filtering.
    mrp: { type: Number, required: true, min: 0, max: MAX_AMOUNT_PAISE, validate: integerValidator },
    discountPct: { type: Number, required: true, min: 0, max: 100, default: 0 },
    netPrice: { type: Number, required: true, min: 0, validate: integerValidator },

    // Tax overrides; null = inherit (category → settings). Effective values are resolved
    // with shared `resolveTax()` and snapshotted onto order lines.
    hsn: { type: String, trim: true, match: HSN_REGEX, default: null },
    taxRate: { type: Number, min: 0, max: 28, default: null },

    unit: { type: String, enum: PRODUCT_UNITS, required: true },
    contentsCount: { type: Number, default: 1, min: 1, validate: integerValidator }, // pieces per unit

    // Inventory. Deductions use a conditional atomic $inc ({ stock: { $gte: qty } });
    // absolute edits must send the expected stockVersion (optimistic concurrency).
    stock: { type: Number, default: 0, min: 0, required: true, validate: integerValidator },
    stockVersion: { type: Number, default: 0, required: true },
    lowStockThreshold: { type: Number, default: 10, min: 0 },
    trackBatches: { type: Boolean, default: false, required: true },

    images: { type: [imageSchema], default: [] },
    videoUrl: { type: String, trim: true, maxlength: 500 },

    // Compliance / safety
    isGreen: { type: Boolean, default: false, required: true },
    soundLevel: { type: String, enum: SOUND_LEVELS, default: 'none' },
    minAge: { type: Number, min: 0, max: 21 },
    safetyWarning: { type: String, trim: true, maxlength: 500 },

    // Combo / gift box contents. `own`: factory pre-packed boxes with their own stock.
    // `components` (deduct component stock) is reserved and rejected for now.
    comboItems: { type: [comboItemSchema], default: [] },
    stockMode: { type: String, enum: COMBO_STOCK_MODES, default: 'own', required: true },

    isActive: { type: Boolean, default: true, required: true },
    isFeatured: { type: Boolean, default: false, required: true },
    sortOrder: { type: Number, default: 0, required: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ...softDeleteFields,
  },
  { timestamps: true },
);

productSchema.plugin(softDeletePlugin);

// Hooks don't run for updateMany: bulk price updates use an aggregation-pipeline
// update that recomputes netPrice server-side (products repository, phase 3).
productSchema.pre('validate', function () {
  try {
    this.netPrice = computeNetPrice(this.mrp, this.discountPct, pricingContext.roundingMode);
  } catch (err) {
    // Out-of-range mrp/discount: surface as a normal validation error.
    this.invalidate('discountPct', err instanceof Error ? err.message : 'Invalid price');
  }
  if (this.stockMode === 'components') {
    this.invalidate('stockMode', 'Component-based combo stock is not supported yet; use "own"');
  }
  if (this.type === 'single' && this.comboItems.length > 0) {
    this.invalidate('comboItems', 'Only combo products can have combo items');
  }
  if (this.type === 'combo' && this.comboItems.length === 0) {
    this.invalidate('comboItems', 'A combo must contain at least one product');
  }
});

productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
productSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
productSchema.index({ category: 1, isActive: 1, sortOrder: 1 });
productSchema.index({ subCategory: 1, sortOrder: 1 });
productSchema.index({ isActive: 1, isFeatured: 1, sortOrder: 1 });
productSchema.index({ type: 1, isActive: 1 });
productSchema.index({ 'comboItems.product': 1 });
productSchema.index({ updatedAt: -1 });
productSchema.index(
  { name: 'text', sku: 'text', tags: 'text' },
  { weights: { sku: 10, name: 5, tags: 1 }, name: 'product_text' },
);

export type Product = InferSchemaType<typeof productSchema>;
export type ProductDocument = HydratedDocument<Product>;
export const ProductModel = model('Product', productSchema);
