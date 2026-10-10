import type { Types } from 'mongoose';
import {
  computeNetPrice,
  divRoundHalfUp,
  percentToBasisPoints,
  roundToRupee,
  type BulkPriceInput,
  type BulkPricePreviewRow,
  type BulkPriceResult,
  type ComboSuggestion,
  type ComboSuggestionInput,
  type ImagesReorderInput,
  type ProductCreateInput,
  type ProductDto,
  type ProductListQuery,
  type ProductPriceInput,
  type ProductUpdateInput,
  type ReorderInput,
} from '@sakthimaan/shared';
import type { RequestMeta } from '../../middlewares/request-context.js';
import {
  CategoryModel,
  ProductModel,
  StockBatchModel,
  pricingContext,
  type Product,
} from '../../models/index.js';
import { processImage, type StorageProvider, type StoredFile } from '../../providers/storage/index.js';
import {
  categoryLookup,
  comboProductLookup,
  pendingDemandFor,
} from '../../repositories/catalog.repository.js';
import { AppError, badRequest, conflict, notFound } from '../../utils/app-error.js';
import { containsRegex, oid, slugify } from '../../utils/query.js';
import { withTransaction } from '../../utils/transaction.js';
import { diffFields, type AuditActor, type AuditService } from '../audit.service.js';
import type { SettingsCache } from '../settings-cache.js';
import type { InventoryService } from './inventory.service.js';
import { toProductDto } from './mappers.js';

export const MAX_PRODUCT_IMAGES = 8;
const MAX_BULK = 2000;

const DETAIL_FIELDS = [
  'name',
  'slug',
  'sku',
  'category',
  'subCategory',
  'description',
  'tags',
  'unit',
  'contentsCount',
  'lowStockThreshold',
  'trackBatches',
  'videoUrl',
  'isGreen',
  'soundLevel',
  'minAge',
  'safetyWarning',
  'isActive',
  'isFeatured',
  'sortOrder',
  'comboItems',
];
const PRICE_FIELDS = ['mrp', 'discountPct', 'netPrice', 'hsn', 'taxRate'];

type LeanProduct = Product & { _id: Types.ObjectId; __v?: number; createdAt?: Date; updatedAt?: Date };

export interface ProductServiceDeps {
  audit: AuditService;
  inventory: InventoryService;
  storage: StorageProvider;
  settings: SettingsCache;
}

export class ProductService {
  constructor(private readonly deps: ProductServiceDeps) {}

  // ------------------------------------------------------------------ queries

  async list(q: ProductListQuery): Promise<{ items: ProductDto[]; total: number }> {
    const filter: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    if (q.deleted) filter.isDeleted = true;
    if (q.q) {
      const rx = containsRegex(q.q);
      and.push({ $or: [{ name: rx }, { sku: rx }, { tags: rx }] });
    }
    if (q.categoryId) {
      and.push({ $or: [{ category: oid(q.categoryId) }, { subCategory: oid(q.categoryId) }] });
    }
    if (and.length > 0) filter.$and = and;
    if (q.type) filter.type = q.type;
    if (q.isActive !== undefined) filter.isActive = q.isActive;
    if (q.isFeatured !== undefined) filter.isFeatured = q.isFeatured;
    if (q.isGreen !== undefined) filter.isGreen = q.isGreen;
    if (q.lowStock) filter.$expr = { $lte: ['$stock', '$lowStockThreshold'] };

    const dir = q.order === 'desc' ? -1 : 1;
    const [docs, total] = await Promise.all([
      ProductModel.find(filter)
        .sort({ [q.sort]: dir, _id: 1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<LeanProduct[]>(),
      ProductModel.countDocuments(filter),
    ]);
    return { items: await this.toDtos(docs), total };
  }

  async get(id: string, opts: { withDeleted?: boolean } = {}): Promise<ProductDto> {
    const doc = await ProductModel.findById(id, null, {
      withDeleted: opts.withDeleted ?? false,
    }).lean<LeanProduct>();
    if (!doc) throw notFound('Product');
    const [dto] = await this.toDtos([doc]);
    if (!dto) throw notFound('Product');
    return dto;
  }

  async toDtos(docs: LeanProduct[]): Promise<ProductDto[]> {
    if (docs.length === 0) return [];
    const comboIds = docs.flatMap((d) => d.comboItems.map((c) => c.product));
    const [categories, comboProducts, demand, taxDefaults] = await Promise.all([
      categoryLookup(),
      comboProductLookup(comboIds),
      pendingDemandFor(docs.map((d) => d._id)),
      this.deps.settings.taxDefaults(),
    ]);
    return docs.map((d) => toProductDto(d, { categories, comboProducts, demand, taxDefaults }));
  }

  // ------------------------------------------------------------------ create / update

  async create(input: ProductCreateInput, actor: AuditActor, meta: RequestMeta): Promise<ProductDto> {
    const { category, subCategory } = await this.resolveCategories(
      input.categoryId,
      input.subCategoryId ?? null,
    );
    const comboItems = input.type === 'combo' ? await this.validateComboItems(input.comboItems ?? []) : [];
    const lowStockThreshold = input.lowStockThreshold ?? (await this.deps.settings.lowStockDefault());
    const slug = input.slug ?? (await this.uniqueSlug(slugify(input.name)));

    const id = await withTransaction(async (session) => {
      const [doc] = await ProductModel.create(
        [
          {
            name: input.name,
            slug,
            sku: input.sku,
            type: input.type,
            category,
            subCategory,
            description: input.description,
            tags: input.tags ?? [],
            mrp: input.mrp,
            discountPct: input.discountPct,
            hsn: input.hsn ?? null,
            taxRate: input.taxRate ?? null,
            unit: input.unit,
            contentsCount: input.contentsCount ?? 1,
            stock: 0,
            lowStockThreshold,
            trackBatches: input.trackBatches ?? false,
            videoUrl: input.videoUrl ?? undefined,
            isGreen: input.isGreen ?? false,
            soundLevel: input.soundLevel ?? 'none',
            minAge: input.minAge ?? undefined,
            safetyWarning: input.safetyWarning,
            comboItems,
            isActive: input.isActive ?? true,
            isFeatured: input.isFeatured ?? false,
            sortOrder: input.sortOrder ?? 0,
            createdBy: actor.user ? oid(actor.user) : undefined,
            updatedBy: actor.user ? oid(actor.user) : undefined,
          },
        ],
        { session },
      );
      if (!doc) throw new Error('Product not created');
      if (input.openingStock > 0) {
        await this.deps.inventory.apply(
          {
            productId: doc._id,
            type: 'stock_in',
            qty: input.openingStock,
            reason: 'Opening stock',
            refType: 'manual',
            ...(input.openingLotNumber ? { lot: { lotNumber: input.openingLotNumber } } : {}),
          },
          actor,
          session,
        );
      }
      await this.deps.audit.record(
        {
          actor,
          action: 'create',
          entity: 'product',
          entityId: String(doc._id),
          entityLabel: doc.sku,
          meta: {
            mrp: doc.mrp,
            discountPct: doc.discountPct,
            netPrice: doc.netPrice,
            openingStock: input.openingStock,
          },
        },
        meta,
        session,
      );
      return doc._id;
    });
    return this.get(String(id));
  }

  /** Non-price fields. Stock is never edited here (use inventory movements). */
  async update(
    id: string,
    input: ProductUpdateInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<ProductDto> {
    const doc = await ProductModel.findById(id);
    if (!doc) throw notFound('Product');
    this.assertVersion(doc, input.version);
    const before = doc.toObject();

    if (input.categoryId !== undefined || input.subCategoryId !== undefined) {
      const categoryId = input.categoryId ?? String(doc.category);
      let subId =
        input.subCategoryId !== undefined
          ? input.subCategoryId
          : doc.subCategory
            ? String(doc.subCategory)
            : null;
      if (input.categoryId !== undefined && input.subCategoryId === undefined && subId) {
        // Category changed without naming a sub-category: keep it only if it belongs there.
        const sub = await CategoryModel.findById(subId).lean();
        if (!sub || String(sub.parent) !== categoryId) subId = null;
      }
      const resolved = await this.resolveCategories(categoryId, subId);
      doc.category = resolved.category;
      doc.subCategory = resolved.subCategory;
    }
    if (input.comboItems !== undefined) {
      if (doc.type !== 'combo') throw badRequest('VALIDATION_ERROR', 'Only gift boxes have contents');
      if (input.comboItems.length === 0)
        throw badRequest('VALIDATION_ERROR', 'A gift box needs at least one product');
      doc.set('comboItems', await this.validateComboItems(input.comboItems, doc._id));
    }
    const simple = [
      'name',
      'slug',
      'sku',
      'description',
      'tags',
      'unit',
      'contentsCount',
      'lowStockThreshold',
      'videoUrl',
      'isGreen',
      'soundLevel',
      'minAge',
      'safetyWarning',
      'isActive',
      'isFeatured',
      'sortOrder',
    ] as const;
    for (const key of simple) {
      if (input[key] !== undefined) doc.set(key, input[key]);
    }
    const enablingBatches = input.trackBatches === true && !doc.trackBatches;
    if (input.trackBatches !== undefined) doc.trackBatches = input.trackBatches;

    const changes = diffFields(before, doc.toObject(), DETAIL_FIELDS);
    if (changes.length === 0) return this.get(id);
    doc.updatedBy = actor.user ? oid(actor.user) : doc.updatedBy;
    doc.increment();

    await withTransaction(async (session) => {
      await doc.save({ session });
      if (
        enablingBatches &&
        doc.stock > 0 &&
        !(await StockBatchModel.exists({ product: doc._id }).session(session))
      ) {
        // Existing stock must belong to a batch, or FIFO deductions would fail.
        await StockBatchModel.create(
          [
            {
              product: doc._id,
              lotNumber: 'OPENING',
              qtyReceived: doc.stock,
              qtyRemaining: doc.stock,
              notes: 'Stock on hand when batch tracking was enabled',
            },
          ],
          { session },
        );
      }
      await this.deps.audit.record(
        { actor, action: 'update', entity: 'product', entityId: id, entityLabel: doc.sku, changes },
        meta,
        session,
      );
    });
    return this.get(id);
  }

  /** MRP, discount and tax overrides: separate permission, audited as price_change. */
  async updatePrice(
    id: string,
    input: ProductPriceInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<ProductDto> {
    const doc = await ProductModel.findById(id);
    if (!doc) throw notFound('Product');
    this.assertVersion(doc, input.version);
    const before = doc.toObject();
    if (input.mrp !== undefined) doc.mrp = input.mrp;
    if (input.discountPct !== undefined) doc.discountPct = input.discountPct;
    if (input.hsn !== undefined) doc.hsn = input.hsn;
    if (input.taxRate !== undefined) doc.taxRate = input.taxRate;
    doc.netPrice = computeNetPrice(doc.mrp, doc.discountPct, pricingContext.roundingMode);

    const changes = diffFields(before, doc.toObject(), PRICE_FIELDS);
    if (changes.length === 0) return this.get(id);
    doc.updatedBy = actor.user ? oid(actor.user) : doc.updatedBy;
    doc.increment();
    await withTransaction(async (session) => {
      await doc.save({ session });
      await this.deps.audit.record(
        { actor, action: 'price_change', entity: 'product', entityId: id, entityLabel: doc.sku, changes },
        meta,
        session,
      );
    });
    return this.get(id);
  }

  /**
   * Bulk price change (e.g. "80% on all Sparklers"). Always computes the full preview with
   * the same rounding as single edits. With dryRun=false, every row is written only if the
   * product's price is still what was previewed; otherwise the whole change rolls back.
   */
  async bulkPrice(input: BulkPriceInput, actor: AuditActor, meta: RequestMeta): Promise<BulkPriceResult> {
    const f = input.filter;
    const filter: Record<string, unknown> = {};
    if (!f.includeInactive) filter.isActive = true;
    if (f.type) filter.type = f.type;
    const or: Record<string, unknown>[] = [];
    if (f.categoryIds?.length) {
      const ids = f.categoryIds.map(oid);
      or.push({ category: { $in: ids } }, { subCategory: { $in: ids } });
    }
    if (f.productIds?.length) or.push({ _id: { $in: f.productIds.map(oid) } });
    if (or.length) filter.$or = or;

    const docs = await ProductModel.find(filter)
      .select('sku name mrp discountPct netPrice')
      .sort({ sku: 1 })
      .limit(MAX_BULK + 1)
      .lean();
    if (docs.length > MAX_BULK) {
      throw badRequest('VALIDATION_ERROR', `Too many products (${MAX_BULK}+). Narrow the selection.`);
    }

    const mode = pricingContext.roundingMode;
    const rows: BulkPricePreviewRow[] = [];
    for (const d of docs) {
      let mrp = d.mrp;
      let discountPct = d.discountPct;
      if (input.change.mode === 'set_discount') {
        discountPct = input.change.discountPct;
      } else {
        const bp = Math.round(input.change.percent * 100);
        mrp = roundToRupee(divRoundHalfUp(d.mrp * (10_000 + bp), 10_000));
      }
      percentToBasisPoints(discountPct); // validates
      const netPrice = computeNetPrice(mrp, discountPct, mode);
      if (mrp !== d.mrp || discountPct !== d.discountPct || netPrice !== d.netPrice) {
        rows.push({
          id: String(d._id),
          sku: d.sku,
          name: d.name,
          before: { mrp: d.mrp, discountPct: d.discountPct, netPrice: d.netPrice },
          after: { mrp, discountPct, netPrice },
        });
      }
    }

    const result: BulkPriceResult = {
      dryRun: input.dryRun,
      matched: docs.length,
      changed: rows.length,
      rows,
    };
    if (input.dryRun || rows.length === 0) return result;

    await withTransaction(async (session) => {
      const res = await ProductModel.bulkWrite(
        rows.map((r) => ({
          updateOne: {
            filter: {
              _id: oid(r.id),
              isDeleted: false,
              mrp: r.before.mrp,
              discountPct: r.before.discountPct,
            },
            update: {
              $set: { ...r.after, updatedBy: actor.user ? oid(actor.user) : undefined },
              $inc: { __v: 1 },
            },
          },
        })),
        { session, ordered: true },
      );
      if (res.matchedCount !== rows.length) {
        throw conflict('VERSION_CONFLICT', 'Some prices changed while you were reviewing. Preview again.');
      }
      await this.deps.audit.record(
        {
          actor,
          action: 'bulk_update',
          entity: 'product',
          summary: `Bulk price change on ${rows.length} product(s)`,
          meta: { change: input.change, filter: input.filter, count: rows.length },
        },
        meta,
        session,
      );
      await this.deps.audit.recordMany(
        rows.map((r) => ({
          actor,
          action: 'price_change' as const,
          entity: 'product' as const,
          entityId: r.id,
          entityLabel: r.sku,
          summary: 'Bulk price change',
          changes: diffFields(r.before, r.after, ['mrp', 'discountPct', 'netPrice']),
        })),
        meta,
        session,
      );
    });
    return { ...result, dryRun: false };
  }

  // ------------------------------------------------------------------ delete / restore / order

  async remove(id: string, actor: AuditActor, meta: RequestMeta): Promise<void> {
    const doc = await ProductModel.findById(id);
    if (!doc) throw notFound('Product');
    const inCombos = await ProductModel.find({ 'comboItems.product': doc._id }).select('sku').lean();
    if (inCombos.length > 0) {
      throw conflict('CONFLICT', 'This product is inside gift box(es). Remove it from them first.', {
        combos: inCombos.map((c) => c.sku),
      });
    }
    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.deletedBy = actor.user ? oid(actor.user) : null;
    doc.increment();
    await withTransaction(async (session) => {
      await doc.save({ session });
      await this.deps.audit.record(
        { actor, action: 'delete', entity: 'product', entityId: id, entityLabel: doc.sku },
        meta,
        session,
      );
    });
  }

  async restore(id: string, actor: AuditActor, meta: RequestMeta): Promise<ProductDto> {
    const doc = await ProductModel.findOne({ _id: oid(id), isDeleted: true });
    if (!doc) throw notFound('Deleted product');
    doc.isDeleted = false;
    doc.deletedAt = null;
    doc.deletedBy = null;
    doc.increment();
    try {
      await withTransaction(async (session) => {
        await doc.save({ session });
        await this.deps.audit.record(
          { actor, action: 'restore', entity: 'product', entityId: id, entityLabel: doc.sku },
          meta,
          session,
        );
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw conflict('DUPLICATE', `Another product now uses SKU ${doc.sku} or its slug. Change it first.`);
      }
      throw err;
    }
    return this.get(id);
  }

  async reorder(input: ReorderInput, actor: AuditActor, meta: RequestMeta): Promise<void> {
    await withTransaction(async (session) => {
      const res = await ProductModel.bulkWrite(
        input.items.map((i) => ({
          updateOne: {
            filter: { _id: oid(i.id), isDeleted: false },
            update: { $set: { sortOrder: i.sortOrder } },
          },
        })),
        { session },
      );
      if (res.matchedCount !== input.items.length) throw notFound('One or more products');
      await this.deps.audit.record(
        {
          actor,
          action: 'bulk_update',
          entity: 'product',
          summary: 'Reordered products',
          meta: { count: input.items.length },
        },
        meta,
        session,
      );
    });
  }

  // ------------------------------------------------------------------ images

  async addImages(id: string, files: Buffer[], actor: AuditActor, meta: RequestMeta): Promise<ProductDto> {
    if (files.length === 0) throw badRequest('VALIDATION_ERROR', 'Choose at least one image');
    const product = await ProductModel.findById(id).select('sku name images').lean();
    if (!product) throw notFound('Product');
    if (product.images.length + files.length > MAX_PRODUCT_IMAGES) {
      throw badRequest('VALIDATION_ERROR', `A product can have at most ${MAX_PRODUCT_IMAGES} images`);
    }
    const processed = await Promise.all(files.map((f) => processImage(f)));
    const stored: StoredFile[] = [];
    try {
      for (const img of processed) stored.push(await this.deps.storage.put({ ...img, folder: 'products' }));
      // Conditional on the image count, so two concurrent uploads can't exceed the limit.
      const res = await ProductModel.updateOne(
        { _id: product._id, [`images.${MAX_PRODUCT_IMAGES - stored.length}`]: { $exists: false } },
        { $push: { images: { $each: stored.map((s) => ({ ...s, alt: product.name })) } }, $inc: { __v: 1 } },
      );
      if (res.modifiedCount !== 1) {
        throw badRequest('VALIDATION_ERROR', `A product can have at most ${MAX_PRODUCT_IMAGES} images`);
      }
    } catch (err) {
      await Promise.all(stored.map((s) => this.deps.storage.remove(s.key).catch(() => undefined)));
      throw err;
    }
    await this.deps.audit.record(
      {
        actor,
        action: 'update',
        entity: 'product',
        entityId: id,
        entityLabel: product.sku,
        summary: `Added ${stored.length} image(s)`,
      },
      meta,
    );
    return this.get(id);
  }

  async removeImage(id: string, key: string, actor: AuditActor, meta: RequestMeta): Promise<ProductDto> {
    const res = await ProductModel.updateOne(
      { _id: oid(id), 'images.key': key },
      { $pull: { images: { key } }, $inc: { __v: 1 } },
    );
    if (res.modifiedCount !== 1) throw notFound('Image');
    await this.deps.storage.remove(key).catch(() => undefined);
    await this.deps.audit.record(
      {
        actor,
        action: 'update',
        entity: 'product',
        entityId: id,
        summary: 'Removed an image',
        meta: { key },
      },
      meta,
    );
    return this.get(id);
  }

  /** First image is the main/cover image. */
  async reorderImages(
    id: string,
    input: ImagesReorderInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<ProductDto> {
    const doc = await ProductModel.findById(id);
    if (!doc) throw notFound('Product');
    this.assertVersion(doc, input.version);
    const current = doc.images.map((i) => i.key);
    if (current.length !== input.keys.length || current.some((k) => !input.keys.includes(k))) {
      throw badRequest('VALIDATION_ERROR', 'Send every current image key exactly once');
    }
    doc.set(
      'images',
      input.keys.map((k) => doc.images.find((i) => i.key === k)),
    );
    doc.increment();
    await doc.save();
    await this.deps.audit.record(
      {
        actor,
        action: 'update',
        entity: 'product',
        entityId: id,
        entityLabel: doc.sku,
        summary: 'Reordered images',
      },
      meta,
    );
    return this.get(id);
  }

  // ------------------------------------------------------------------ combos

  /**
   * Suggested gift-box price: box MRP = Σ item MRP (rounded up to the rupee), discount
   * chosen so the box's net price ≈ Σ item net prices, less an optional extra bundle %.
   */
  async comboSuggestion(input: ComboSuggestionInput): Promise<ComboSuggestion> {
    const products = await this.loadComboProducts(input.items.map((i) => i.productId));
    const items = input.items.map((i) => {
      const p = products.get(i.productId);
      if (!p) throw badRequest('VALIDATION_ERROR', 'Product not found');
      return {
        productId: i.productId,
        sku: p.sku,
        name: p.name,
        qty: i.qty,
        mrp: p.mrp,
        netPrice: p.netPrice,
      };
    });
    const itemsMrpTotal = items.reduce((s, i) => s + i.mrp * i.qty, 0);
    const itemsNetTotal = items.reduce((s, i) => s + i.netPrice * i.qty, 0);
    const mrp = Math.ceil(itemsMrpTotal / 100) * 100;
    const target = divRoundHalfUp(
      itemsNetTotal * (10_000 - percentToBasisPoints(input.extraDiscountPct)),
      10_000,
    );
    const discountPct =
      mrp === 0 ? 0 : Math.max(0, Math.min(100, Math.floor((1 - target / mrp) * 10_000) / 100));
    const netPrice = computeNetPrice(mrp, discountPct, pricingContext.roundingMode);
    return {
      items,
      itemsMrpTotal,
      itemsNetTotal,
      suggested: { mrp, discountPct, netPrice },
      savingsVsSeparate: Math.max(0, itemsNetTotal - netPrice),
    };
  }

  // ------------------------------------------------------------------ helpers

  private assertVersion(doc: { __v?: number; sku: string }, version: number): void {
    if ((doc.__v ?? 0) !== version) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        `${doc.sku} was changed by someone else. Reload to see the latest and try again.`,
        { currentVersion: doc.__v ?? 0 },
      );
    }
  }

  private async resolveCategories(categoryId: string, subCategoryId: string | null) {
    const category = await CategoryModel.findById(categoryId).lean();
    if (!category)
      throw badRequest('VALIDATION_ERROR', 'Category not found', [
        { location: 'body', path: 'categoryId', message: 'Category not found', code: 'custom' },
      ]);
    if (category.parent) {
      throw badRequest('VALIDATION_ERROR', 'Choose a top-level category (and the sub-category separately)', [
        { location: 'body', path: 'categoryId', message: 'This is a sub-category', code: 'custom' },
      ]);
    }
    if (!subCategoryId) return { category: category._id, subCategory: null };
    const sub = await CategoryModel.findById(subCategoryId).lean();
    if (!sub || String(sub.parent) !== String(category._id)) {
      throw badRequest('VALIDATION_ERROR', 'Sub-category does not belong to this category', [
        {
          location: 'body',
          path: 'subCategoryId',
          message: 'Not a sub-category of the chosen category',
          code: 'custom',
        },
      ]);
    }
    return { category: category._id, subCategory: sub._id };
  }

  private async loadComboProducts(ids: string[]) {
    const docs = await ProductModel.find({ _id: { $in: ids.map(oid) } })
      .select('sku name type mrp netPrice')
      .lean();
    for (const d of docs) {
      if (d.type === 'combo')
        throw badRequest('VALIDATION_ERROR', `${d.sku} is itself a gift box; boxes can't be nested`);
    }
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  private async validateComboItems(items: { productId: string; qty: number }[], selfId?: Types.ObjectId) {
    if (selfId && items.some((i) => i.productId === String(selfId))) {
      throw badRequest('VALIDATION_ERROR', 'A gift box cannot contain itself');
    }
    const products = await this.loadComboProducts(items.map((i) => i.productId));
    const missing = items.filter((i) => !products.has(i.productId));
    if (missing.length > 0) {
      throw badRequest('VALIDATION_ERROR', 'Some gift box products were not found', {
        productIds: missing.map((m) => m.productId),
      });
    }
    return items.map((i) => ({ product: oid(i.productId), qty: i.qty }));
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || 'product';
    for (let i = 1; i < 200; i++) {
      const candidate = i === 1 ? root : `${root}-${i}`;
      if (!(await ProductModel.exists({ slug: candidate }))) return candidate;
    }
    return `${root}-${Date.now()}`;
  }
}
