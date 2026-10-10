import { z } from 'zod';
import { PRODUCT_TYPES, PRODUCT_UNITS, SOUND_LEVELS, STOCK_MOVEMENT_TYPES } from '../enums.js';
import {
  boolQuery,
  cursorQuery,
  hsnSchema,
  httpUrlSchema,
  objectIdSchema,
  pageQuery,
  paiseSchema,
  percentSchema,
  plainText,
  slugSchema,
  taxRateSchema,
} from './common.schemas.js';

// ------------------------------------------------------------------ categories

const categoryFields = {
  name: plainText(80).pipe(z.string().min(2, 'Name is too short')),
  slug: slugSchema.optional(),
  parentId: objectIdSchema.nullable().optional(),
  description: plainText(1000).optional(),
  hsn: hsnSchema.nullable().optional(),
  taxRate: taxRateSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
};

export const categoryCreateSchema = z.strictObject(categoryFields);
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z
  .strictObject(categoryFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// ------------------------------------------------------------------ products

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9\-_/]{0,39}$/, 'SKU: letters, numbers, - _ / only (max 40)');

const comboItemsSchema = z
  .array(z.strictObject({ productId: objectIdSchema, qty: z.number().int().min(1).max(1000) }))
  .max(50)
  .refine(
    (items) => new Set(items.map((i) => i.productId)).size === items.length,
    'Each product once per combo',
  );

const productFields = {
  name: plainText(150).pipe(z.string().min(2, 'Name is too short')),
  slug: slugSchema.optional(),
  categoryId: objectIdSchema,
  subCategoryId: objectIdSchema.nullable().optional(),
  description: plainText(5000).optional(),
  tags: z
    .array(plainText(30).pipe(z.string().min(1)))
    .max(20)
    .optional(),
  unit: z.enum(PRODUCT_UNITS),
  contentsCount: z.number().int().min(1).max(100_000).optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
  trackBatches: z.boolean().optional(),
  videoUrl: httpUrlSchema.nullable().optional(),
  isGreen: z.boolean().optional(),
  soundLevel: z.enum(SOUND_LEVELS).optional(),
  minAge: z.number().int().min(0).max(21).nullable().optional(),
  safetyWarning: plainText(500).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
};

const priceFields = {
  mrp: paiseSchema,
  discountPct: percentSchema,
  hsn: hsnSchema.nullable().optional(),
  taxRate: taxRateSchema.nullable().optional(),
};

export const productCreateSchema = z
  .strictObject({
    ...productFields,
    ...priceFields,
    sku: skuSchema,
    type: z.enum(PRODUCT_TYPES).default('single'),
    discountPct: percentSchema.default(0),
    comboItems: comboItemsSchema.optional(),
    openingStock: z.number().int().min(0).max(10_000_000).default(0),
    openingLotNumber: plainText(60).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'combo' && !v.comboItems?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['comboItems'],
        message: 'A gift box needs at least one product',
      });
    }
    if (v.type === 'single' && v.comboItems?.length) {
      ctx.addIssue({ code: 'custom', path: ['comboItems'], message: 'Only gift boxes have contents' });
    }
  });
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

/** Non-price fields. `version` is the product's current version (optimistic concurrency). */
export const productUpdateSchema = z
  .strictObject({ ...productFields, sku: skuSchema, comboItems: comboItemsSchema })
  .partial()
  .extend({ version: z.number().int().min(0) })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

/** Price & tax fields (needs products:update_price). */
export const productPriceSchema = z
  .strictObject({
    version: z.number().int().min(0),
    mrp: paiseSchema.optional(),
    discountPct: percentSchema.optional(),
    hsn: hsnSchema.nullable().optional(),
    taxRate: taxRateSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type ProductPriceInput = z.infer<typeof productPriceSchema>;

export const bulkPriceSchema = z.strictObject({
  filter: z
    .strictObject({
      categoryIds: z.array(objectIdSchema).max(100).optional(),
      productIds: z.array(objectIdSchema).max(2000).optional(),
      type: z.enum(PRODUCT_TYPES).optional(),
      includeInactive: z.boolean().default(false),
    })
    .refine(
      (f) => (f.categoryIds?.length ?? 0) + (f.productIds?.length ?? 0) > 0 || f.type !== undefined,
      'Choose categories, products or a product type',
    ),
  change: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('set_discount'), discountPct: percentSchema }),
    z.strictObject({
      mode: z.literal('adjust_mrp'),
      /** e.g. 10 = +10%, -5 = −5%. New MRP is rounded to whole rupees. */
      percent: z
        .number()
        .min(-90)
        .max(300)
        .refine((v) => v !== 0, 'Must not be 0'),
    }),
  ]),
  dryRun: z.boolean().default(true),
});
export type BulkPriceInput = z.infer<typeof bulkPriceSchema>;

export const imagesReorderSchema = z.strictObject({
  version: z.number().int().min(0),
  keys: z.array(z.string().min(1).max(300)).min(1).max(20),
});
export type ImagesReorderInput = z.infer<typeof imagesReorderSchema>;

export const PRODUCT_SORTS = ['sortOrder', 'name', 'netPrice', 'stock', 'updatedAt', 'createdAt'] as const;

export const productListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: objectIdSchema.optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  isActive: boolQuery.optional(),
  isFeatured: boolQuery.optional(),
  isGreen: boolQuery.optional(),
  lowStock: boolQuery.optional(),
  deleted: boolQuery.optional(),
  sort: z.enum(PRODUCT_SORTS).default('sortOrder'),
  order: z.enum(['asc', 'desc']).default('asc'),
  ...pageQuery,
});
export type ProductListQuery = z.infer<typeof productListQuery>;

export const comboSuggestionSchema = z.strictObject({
  items: comboItemsSchema.refine((items) => items.length > 0, 'Add at least one product'),
  /** Extra bundle discount on top of the items' own net prices. */
  extraDiscountPct: percentSchema.default(0),
});
export type ComboSuggestionInput = z.infer<typeof comboSuggestionSchema>;

export const priceListQuery = z.object({
  categoryId: objectIdSchema.optional(),
  includeOutOfStock: boolQuery.default(true),
  includeCombos: boolQuery.default(true),
});
export type PriceListQuery = z.infer<typeof priceListQuery>;

export const exportQuery = z.object({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  categoryId: objectIdSchema.optional(),
  includeInactive: boolQuery.default(true),
});
export type ExportQuery = z.infer<typeof exportQuery>;

export const importQuery = z.object({
  dryRun: boolQuery.default(true),
  createMissingCategories: boolQuery.default(false),
  updateExisting: boolQuery.default(true),
});
export type ImportQuery = z.infer<typeof importQuery>;

export const templateQuery = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') });

// ------------------------------------------------------------------ inventory

const lotFields = {
  lotNumber: plainText(60).pipe(z.string().min(1)).optional(),
  supplier: plainText(150).optional(),
  manufacturedAt: z.coerce.date().optional(),
  costPrice: paiseSchema.optional(),
};

export const stockMovementSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('stock_in'),
    productId: objectIdSchema,
    qty: z.number().int().min(1).max(10_000_000),
    reason: plainText(300).optional(),
    ...lotFields,
  }),
  z.strictObject({
    type: z.literal('stock_out'),
    productId: objectIdSchema,
    qty: z.number().int().min(1).max(10_000_000),
    reason: plainText(300).pipe(z.string().min(3, 'Say why stock is going out (damage, sample, ...)')),
    batchId: objectIdSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('adjustment'),
    productId: objectIdSchema,
    newStock: z.number().int().min(0).max(10_000_000),
    /** stockVersion the user saw; a concurrent change makes this a 409. */
    expectedStockVersion: z.number().int().min(0),
    reason: plainText(300).pipe(z.string().min(3, 'Say why (e.g. physical count)')),
    batchId: objectIdSchema.optional(),
  }),
]);
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

export const movementListQuery = z.object({
  productId: objectIdSchema.optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  refType: z.enum(['order', 'import', 'manual']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...cursorQuery,
});
export type MovementListQuery = z.infer<typeof movementListQuery>;

export const lowStockQuery = z.object({ categoryId: objectIdSchema.optional(), ...pageQuery });
export type LowStockQuery = z.infer<typeof lowStockQuery>;

export const demandQuery = z.object({ onlyShort: boolQuery.default(false), ...pageQuery });
export type DemandQuery = z.infer<typeof demandQuery>;

export const batchListQuery = z.object({
  productId: objectIdSchema,
  onlyAvailable: boolQuery.default(false),
});

export const batchUpdateSchema = z
  .strictObject({
    supplier: plainText(150).optional(),
    manufacturedAt: z.coerce.date().nullable().optional(),
    notes: plainText(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type BatchUpdateInput = z.infer<typeof batchUpdateSchema>;
