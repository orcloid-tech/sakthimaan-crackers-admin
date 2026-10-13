import { z } from 'zod';
import { INDIAN_STATE_CODES } from '../states.js';
import { boolQuery, plainText, slugSchema } from './common.schemas.js';

/** GET /api/v1/public/products and /gift-boxes. */
export const storefrontProductQuery = z.object({
  category: slugSchema.optional(),
  q: z.string().trim().max(60).optional(),
  type: z.enum(['single', 'combo']).optional(),
  green: boolQuery.optional(),
  featured: boolQuery.optional(),
  inStock: boolQuery.optional(),
  sort: z.enum(['featured', 'price_asc', 'price_desc', 'discount', 'name', 'newest']).default('featured'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type StorefrontProductQueryInput = z.infer<typeof storefrontProductQuery>;

export const storefrontSlugParams = z.strictObject({ slug: slugSchema });

export const storefrontServiceabilityQuery = z.object({
  stateCode: z.enum(INDIAN_STATE_CODES),
  city: plainText(100).optional(),
});

export const storefrontPriceListQuery = z.object({ category: slugSchema.optional() });
