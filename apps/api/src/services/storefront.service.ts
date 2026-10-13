import type { Types } from 'mongoose';
import {
  INDIAN_STATES,
  type IndianStateCode,
  type StorefrontCategory,
  type StorefrontDelivery,
  type StorefrontImage,
  type StorefrontProduct,
  type StorefrontProductCard,
  type StorefrontProductQueryInput,
  type StorefrontServiceability,
  type StorefrontStore,
} from '@sakthimaan/shared';
import {
  CategoryModel,
  CityModel,
  ProductModel,
  SETTINGS_ID,
  ServiceStateModel,
  SettingsModel,
  ZoneModel,
  type Product,
} from '../models/index.js';
import { notFound } from '../utils/app-error.js';
import { containsRegex } from '../utils/query.js';
import type { PriceListService } from './catalog/price-list.service.js';
import type { OrderBuilder } from './orders/order-builder.js';

/** Turns stored (possibly relative, e.g. local /uploads) URLs into absolute ones for the website. */
export type AbsoluteUrl = (url: string) => string;

type CategoryInfo = { id: string; slug: string; name: string; parent: string | null; isActive: boolean };
type LeanProduct = Product & { _id: Types.ObjectId; createdAt?: Date };

const SORTS = {
  featured: { isFeatured: -1, sortOrder: 1, name: 1 },
  price_asc: { netPrice: 1, name: 1 },
  price_desc: { netPrice: -1, name: 1 },
  discount: { discountPct: -1, name: 1 },
  name: { name: 1 },
  newest: { createdAt: -1 },
} as const;

const PRICE_LIST_TTL_MS = 5 * 60_000;

/**
 * What the customer website reads: store details, catalogue (active products in active
 * categories only), delivery terms, serviceability and the price list. Never exposes
 * cost, stock counts, tax setup or anything staff-only.
 */
export class StorefrontService {
  private priceListCache = new Map<string, { at: number; pdf: Buffer }>();

  constructor(private readonly deps: { builder: OrderBuilder; priceList: PriceListService }) {}

  async store(abs: AbsoluteUrl): Promise<StorefrontStore> {
    const doc = await SettingsModel.findById(SETTINGS_ID).lean();
    // Unconfigured store: fall back to schema defaults (no business values).
    const s = doc ?? new SettingsModel({}).toObject();
    const company = s.company;
    const storefront = s.storefront;
    const isOpen = storefront?.isOpen ?? true;
    const announcement = storefront?.announcement;
    const pay = s.payment;
    return {
      configured: doc !== null,
      name: company?.name ?? '',
      logoUrl: company?.logo?.url ? abs(company.logo.url) : null,
      phones: company?.phones ?? [],
      whatsappNumber: company?.whatsappNumber ?? null,
      email: company?.email ?? null,
      address: company?.address ?? null,
      gstin: company?.gstin ?? null,
      licenseNumber: company?.licenseNumber ?? null,
      isOpen,
      closedMessage: isOpen ? null : (storefront?.closedMessage ?? null),
      orderMode: storefront?.orderMode ?? 'enquiry',
      acceptedPaymentMethods: pay?.acceptedMethods ?? [],
      announcement: announcement?.isActive
        ? { text: announcement.text ?? null, linkUrl: announcement.linkUrl ?? null }
        : null,
      minOrderValue: s.order?.defaultMinOrderValue ?? null,
      safetyPageSlug: storefront?.safetyPageSlug ?? null,
      payment:
        pay?.showUpiQrOnStorefront && (pay.upiId || pay.bank?.accountNumber)
          ? {
              upiId: pay.upiId ?? null,
              upiPayeeName: pay.upiPayeeName ?? null,
              upiQrImageUrl: pay.upiQrImage?.url ? abs(pay.upiQrImage.url) : null,
              bank: pay.bank ?? null,
              instructions: pay.instructions ?? null,
            }
          : null,
    };
  }

  // ---------------------------------------------------------------- catalogue

  private async categoryMap(): Promise<Map<string, CategoryInfo>> {
    const cats = await CategoryModel.find({}, { name: 1, slug: 1, parent: 1, isActive: 1 }).lean();
    return new Map(
      cats.map((c) => [
        String(c._id),
        {
          id: String(c._id),
          slug: c.slug,
          name: c.name,
          parent: c.parent ? String(c.parent) : null,
          isActive: c.isActive,
        },
      ]),
    );
  }

  /** Active categories whose parent (if any) is active too. */
  private visibleIds(cats: Map<string, CategoryInfo>): string[] {
    return [...cats.values()]
      .filter((c) => c.isActive && (!c.parent || cats.get(c.parent)?.isActive))
      .map((c) => c.id);
  }

  async categories(abs: AbsoluteUrl): Promise<StorefrontCategory[]> {
    const [cats, full, counts] = await Promise.all([
      this.categoryMap(),
      CategoryModel.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      ProductModel.aggregate<{ _id: { c: Types.ObjectId; s: Types.ObjectId | null }; n: number }>([
        { $match: { isActive: true } },
        { $group: { _id: { c: '$category', s: '$subCategory' }, n: { $sum: 1 } } },
      ]),
    ]);
    const visible = new Set(this.visibleIds(cats));
    const own = new Map<string, number>();
    const sub = new Map<string, number>();
    for (const r of counts) {
      own.set(String(r._id.c), (own.get(String(r._id.c)) ?? 0) + r.n);
      if (r._id.s) sub.set(String(r._id.s), (sub.get(String(r._id.s)) ?? 0) + r.n);
    }
    const node = (c: (typeof full)[number], children: StorefrontCategory[]): StorefrontCategory => ({
      id: String(c._id),
      slug: c.slug,
      name: c.name,
      description: c.description ?? null,
      image: c.image ? image(c.image, abs) : null,
      productCount: c.parent ? (sub.get(String(c._id)) ?? 0) : (own.get(String(c._id)) ?? 0),
      children,
    });
    const shown = full.filter((c) => visible.has(String(c._id)));
    return shown
      .filter((c) => !c.parent)
      .map((p) =>
        node(
          p,
          shown.filter((c) => String(c.parent) === String(p._id)).map((c) => node(c, [])),
        ),
      );
  }

  async products(
    q: StorefrontProductQueryInput,
    abs: AbsoluteUrl,
  ): Promise<{ items: StorefrontProductCard[]; total: number }> {
    const cats = await this.categoryMap();
    const visible = this.visibleIds(cats);
    const filter: Record<string, unknown> = { isActive: true, category: { $in: visible } };
    if (q.category) {
      const c = [...cats.values()].find((x) => x.slug === q.category && visible.includes(x.id));
      if (!c) return { items: [], total: 0 };
      if (c.parent) filter.subCategory = c.id;
      else filter.category = c.id;
    }
    if (q.type) filter.type = q.type;
    if (q.green !== undefined) filter.isGreen = q.green;
    if (q.featured !== undefined) filter.isFeatured = q.featured;
    if (q.inStock) filter.stock = { $gt: 0 };
    if (q.q) {
      const rx = containsRegex(q.q);
      filter.$or = [{ name: rx }, { sku: rx }, { tags: rx }];
    }
    const [rows, total] = await Promise.all([
      ProductModel.find(filter)
        .sort(SORTS[q.sort])
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<LeanProduct[]>(),
      ProductModel.countDocuments(filter),
    ]);
    return { items: rows.map((p) => card(p, cats, abs)), total };
  }

  async product(slug: string, abs: AbsoluteUrl): Promise<StorefrontProduct> {
    const [cats, p] = await Promise.all([
      this.categoryMap(),
      ProductModel.findOne({ slug, isActive: true }).lean<LeanProduct>(),
    ]);
    if (!p || !this.visibleIds(cats).includes(String(p.category))) throw notFound('Product');
    const parts = p.comboItems.length
      ? await ProductModel.find(
          { _id: { $in: p.comboItems.map((c) => c.product) } },
          { name: 1 },
          { withDeleted: true },
        ).lean()
      : [];
    const names = new Map(parts.map((x) => [String(x._id), x.name]));
    return {
      ...card(p, cats, abs),
      description: p.description ?? null,
      images: p.images.map((i) => image(i, abs)),
      videoUrl: p.videoUrl ?? null,
      safetyWarning: p.safetyWarning ?? null,
      contents: p.comboItems.map((c) => ({ name: names.get(String(c.product)) ?? '', qty: c.qty })),
    };
  }

  // ---------------------------------------------------------------- delivery

  async delivery(): Promise<StorefrontDelivery> {
    const [settings, states, zones, cities] = await Promise.all([
      SettingsModel.findById(SETTINGS_ID, { order: 1 }).lean(),
      ServiceStateModel.find().lean(),
      ZoneModel.find({ isActive: true }).lean(),
      CityModel.find().sort({ stateCode: 1, nameKey: 1 }).lean(),
    ]);
    const storeMin = settings?.order?.defaultMinOrderValue ?? 0;
    const zoneById = new Map(zones.map((z) => [String(z._id), z]));
    const byCode = new Map(states.map((s) => [s.code, s]));
    return {
      defaultMinOrderValue: storeMin,
      states: INDIAN_STATES.map((ref) => {
        const s = byCode.get(ref.code);
        const z = s?.zone ? zoneById.get(String(s.zone)) : undefined;
        return {
          code: ref.code,
          name: ref.name,
          isServiceable: s?.isServiceable ?? false,
          minOrderValue: s?.minOrderValue ?? z?.minOrderValue ?? storeMin,
          note: s?.isServiceable ? null : (s?.restrictionNote ?? null),
          zone: z
            ? {
                name: z.name,
                deliveryChargeMode: z.deliveryChargeMode,
                deliveryRules: z.deliveryRules.map((r) => ({
                  minOrderValue: r.minOrderValue ?? 0,
                  maxOrderValue: r.maxOrderValue ?? null,
                  type: r.type,
                  value: r.value ?? 0,
                })),
                estimatedDays:
                  z.estimatedDeliveryDays?.min != null && z.estimatedDeliveryDays.max != null
                    ? { min: z.estimatedDeliveryDays.min, max: z.estimatedDeliveryDays.max }
                    : null,
              }
            : null,
        };
      }),
      cities: cities.map((c) => ({
        stateCode: c.stateCode,
        name: c.name,
        isServiceable: c.isServiceable,
        minOrderValue: c.minOrderValue ?? null,
        note: c.restrictionNote ?? null,
      })),
    };
  }

  serviceability(stateCode: IndianStateCode, city?: string): Promise<StorefrontServiceability> {
    return this.deps.builder.serviceability(stateCode, city);
  }

  // ---------------------------------------------------------------- price list

  /** Same PDF as the admin's price list; cached briefly (it is the heaviest public request). */
  async priceList(categorySlug?: string): Promise<Buffer> {
    const key = categorySlug ?? '*';
    const hit = this.priceListCache.get(key);
    if (hit && Date.now() - hit.at < PRICE_LIST_TTL_MS) return hit.pdf;
    let categoryId: string | undefined;
    if (categorySlug) {
      const c = await CategoryModel.findOne({ slug: categorySlug, isActive: true }, { _id: 1 }).lean();
      if (!c) throw notFound('Category');
      categoryId = String(c._id);
    }
    const pdf = await this.deps.priceList.render({
      categoryId,
      includeOutOfStock: true,
      includeCombos: true,
    });
    this.priceListCache.set(key, { at: Date.now(), pdf });
    return pdf;
  }
}

function image(
  i: { url: string; alt?: string | null; width?: number | null; height?: number | null },
  abs: AbsoluteUrl,
): StorefrontImage {
  return { url: abs(i.url), alt: i.alt ?? null, width: i.width ?? null, height: i.height ?? null };
}

function card(p: LeanProduct, cats: Map<string, CategoryInfo>, abs: AbsoluteUrl): StorefrontProductCard {
  const cat = cats.get(String(p.category));
  const sub = p.subCategory ? cats.get(String(p.subCategory)) : undefined;
  const first = p.images[0];
  return {
    id: String(p._id),
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    type: p.type,
    category: cat ? { slug: cat.slug, name: cat.name } : null,
    subCategory: sub ? { slug: sub.slug, name: sub.name } : null,
    mrp: p.mrp,
    discountPct: p.discountPct,
    netPrice: p.netPrice,
    unit: p.unit,
    contentsCount: p.contentsCount ?? 1,
    isGreen: p.isGreen,
    soundLevel: p.soundLevel ?? 'none',
    minAge: p.minAge ?? null,
    isFeatured: p.isFeatured,
    inStock: p.stock > 0,
    image: first ? image(first, abs) : null,
    tags: p.tags,
  };
}
