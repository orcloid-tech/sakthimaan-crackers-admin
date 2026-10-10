import type { Types } from 'mongoose';
import {
  resolveTax,
  type CategoryDto,
  type ComboItemDto,
  type ImageRefDto,
  type ProductDto,
  type StockMovementDto,
} from '@sakthimaan/shared';
import type { Category, Product, StockMovement } from '../../models/index.js';

type WithId<T> = T & { _id: Types.ObjectId; __v?: number };
type Lean<T> = WithId<T> & { createdAt?: Date; updatedAt?: Date };

const idOrNull = (v: Types.ObjectId | null | undefined) => (v ? String(v) : null);

export function toImageDto(img: {
  provider: string;
  key: string;
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}): ImageRefDto {
  return {
    provider: img.provider as ImageRefDto['provider'],
    key: img.key,
    url: img.url,
    width: img.width ?? null,
    height: img.height ?? null,
    alt: img.alt ?? null,
  };
}

export function toCategoryDto(c: Lean<Category>, productCount = 0): CategoryDto {
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    parentId: idOrNull(c.parent),
    description: c.description ?? null,
    image: c.image ? toImageDto(c.image) : null,
    hsn: c.hsn ?? null,
    taxRate: c.taxRate ?? null,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    productCount,
  };
}

export interface ProductMapContext {
  categories: ReadonlyMap<string, { name: string; hsn?: string | null; taxRate?: number | null }>;
  comboProducts: ReadonlyMap<
    string,
    { sku: string; name: string; mrp: number; netPrice: number; isActive: boolean }
  >;
  demand: ReadonlyMap<string, number>;
  taxDefaults: { hsn: string; taxRate: number };
}

export function toProductDto(p: Lean<Product>, ctx: ProductMapContext): ProductDto {
  const category = ctx.categories.get(String(p.category));
  const subCategory = p.subCategory ? ctx.categories.get(String(p.subCategory)) : undefined;
  // Sub-category overrides apply before the parent category's.
  const inherited =
    subCategory?.hsn != null || subCategory?.taxRate != null
      ? { hsn: subCategory.hsn ?? category?.hsn, taxRate: subCategory.taxRate ?? category?.taxRate }
      : category;
  const comboItems: ComboItemDto[] = p.comboItems.map((ci) => {
    const item = ctx.comboProducts.get(String(ci.product));
    return {
      productId: String(ci.product),
      qty: ci.qty,
      sku: item?.sku ?? null,
      name: item?.name ?? null,
      mrp: item?.mrp ?? null,
      netPrice: item?.netPrice ?? null,
      isActive: item?.isActive ?? null,
    };
  });
  const lowStockThreshold = p.lowStockThreshold ?? 0;
  return {
    id: String(p._id),
    version: p.__v ?? 0,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    type: p.type,
    category: category ? { id: String(p.category), name: category.name } : null,
    subCategory: p.subCategory && subCategory ? { id: String(p.subCategory), name: subCategory.name } : null,
    description: p.description ?? null,
    tags: p.tags,
    mrp: p.mrp,
    discountPct: p.discountPct,
    netPrice: p.netPrice,
    hsn: p.hsn ?? null,
    taxRate: p.taxRate ?? null,
    effectiveTax: resolveTax(p, inherited, ctx.taxDefaults),
    unit: p.unit,
    contentsCount: p.contentsCount ?? 1,
    stock: p.stock,
    stockVersion: p.stockVersion,
    lowStockThreshold,
    isLowStock: p.stock <= lowStockThreshold,
    trackBatches: p.trackBatches,
    pendingDemand: ctx.demand.get(String(p._id)) ?? 0,
    images: p.images.map(toImageDto),
    videoUrl: p.videoUrl ?? null,
    isGreen: p.isGreen,
    soundLevel: p.soundLevel ?? 'none',
    minAge: p.minAge ?? null,
    safetyWarning: p.safetyWarning ?? null,
    comboItems,
    stockMode: p.stockMode,
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    sortOrder: p.sortOrder,
    isDeleted: p.isDeleted,
    createdAt: (p.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (p.updatedAt ?? new Date(0)).toISOString(),
  };
}

export function toMovementDto(
  m: Lean<StockMovement>,
  products: ReadonlyMap<string, { sku: string; name: string }>,
): StockMovementDto {
  return {
    id: String(m._id),
    productId: String(m.product),
    product: products.get(String(m.product)) ?? null,
    batchId: idOrNull(m.batch),
    type: m.type,
    qty: m.qty,
    balanceBefore: m.balanceBefore,
    balanceAfter: m.balanceAfter,
    reason: m.reason ?? null,
    refType: m.refType,
    refId: idOrNull(m.refId),
    refLabel: m.refLabel ?? null,
    actor: { userId: idOrNull(m.actor.user), name: m.actor.name },
    createdAt: (m.createdAt ?? new Date(0)).toISOString(),
  };
}
