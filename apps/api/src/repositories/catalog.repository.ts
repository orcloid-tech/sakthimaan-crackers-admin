import type { PipelineStage, Types } from 'mongoose';
import { DEMAND_STATUSES, type DemandRow, type MovementListQuery } from '@sakthimaan/shared';
import {
  CategoryModel,
  OrderModel,
  ProductModel,
  StockMovementModel,
  activeMatch,
  type StockMovement,
} from '../models/index.js';
import { beforeCursor, cursorPage, oid } from '../utils/query.js';

/**
 * Read-side queries for the catalogue: aggregations and joins live here so services
 * keep business rules only.
 */

/** Quantity on open enquiries per product (stock is only deducted on Confirm). */
export async function pendingDemandFor(productIds: readonly Types.ObjectId[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await OrderModel.aggregate<{ _id: Types.ObjectId; qty: number }>([
    {
      $match: {
        isDeleted: false,
        status: { $in: [...DEMAND_STATUSES] },
        'items.product': { $in: productIds },
      },
    },
    { $unwind: '$items' },
    { $match: { 'items.product': { $in: productIds } } },
    { $group: { _id: '$items.product', qty: { $sum: '$items.qty' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.qty]));
}

/** Pending enquiry demand vs stock for every product on open enquiries. */
export async function demandReport(opts: {
  onlyShort: boolean;
  page: number;
  pageSize: number;
}): Promise<{ rows: DemandRow[]; total: number }> {
  const pipeline: PipelineStage[] = [
    { $match: { isDeleted: false, status: { $in: [...DEMAND_STATUSES] } } },
    { $unwind: '$items' },
    {
      $group: { _id: '$items.product', pendingDemand: { $sum: '$items.qty' }, orders: { $addToSet: '$_id' } },
    },
    {
      $lookup: {
        from: ProductModel.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'product',
        pipeline: [{ $project: { sku: 1, name: 1, stock: 1 } }],
      },
    },
    { $unwind: '$product' },
    {
      $project: {
        _id: 0,
        productId: { $toString: '$_id' },
        sku: '$product.sku',
        name: '$product.name',
        stock: '$product.stock',
        pendingDemand: 1,
        enquiryCount: { $size: '$orders' },
        shortBy: { $max: [0, { $subtract: ['$pendingDemand', '$product.stock'] }] },
      },
    },
    ...(opts.onlyShort ? [{ $match: { shortBy: { $gt: 0 } } }] : []),
    { $sort: { shortBy: -1, pendingDemand: -1, sku: 1 } },
    {
      $facet: {
        rows: [{ $skip: (opts.page - 1) * opts.pageSize }, { $limit: opts.pageSize }],
        total: [{ $count: 'n' }],
      },
    },
  ];
  const [result] = await OrderModel.aggregate<{ rows: DemandRow[]; total: { n: number }[] }>(pipeline);
  return { rows: result?.rows ?? [], total: result?.total[0]?.n ?? 0 };
}

/** Category id → {name, hsn, taxRate} for every category (small collection). */
export async function categoryLookup(): Promise<
  Map<string, { name: string; parent: string | null; hsn?: string | null; taxRate?: number | null }>
> {
  const cats = await CategoryModel.find(
    {},
    { name: 1, parent: 1, hsn: 1, taxRate: 1 },
    { withDeleted: true },
  ).lean();
  return new Map(
    cats.map((c) => [
      String(c._id),
      { name: c.name, parent: c.parent ? String(c.parent) : null, hsn: c.hsn, taxRate: c.taxRate },
    ]),
  );
}

export async function comboProductLookup(ids: readonly Types.ObjectId[]) {
  if (ids.length === 0)
    return new Map<string, { sku: string; name: string; mrp: number; netPrice: number; isActive: boolean }>();
  const rows = await ProductModel.find(
    { _id: { $in: ids } },
    { sku: 1, name: 1, mrp: 1, netPrice: 1, isActive: 1, isDeleted: 1 },
    { withDeleted: true },
  ).lean();
  return new Map(
    rows.map((p) => [
      String(p._id),
      { sku: p.sku, name: p.name, mrp: p.mrp, netPrice: p.netPrice, isActive: p.isActive && !p.isDeleted },
    ]),
  );
}

/** Active products at or below their low-stock threshold, emptiest first. */
export async function lowStockProducts(opts: { categoryId?: string; page: number; pageSize: number }) {
  const match: Record<string, unknown> = {
    isDeleted: false,
    isActive: true,
    $expr: { $lte: ['$stock', '$lowStockThreshold'] },
  };
  if (opts.categoryId) {
    match.$or = [{ category: oid(opts.categoryId) }, { subCategory: oid(opts.categoryId) }];
  }
  const [items, total] = await Promise.all([
    ProductModel.find(match)
      .sort({ stock: 1, sku: 1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .lean(),
    ProductModel.countDocuments(match),
  ]);
  return { items, total };
}

export async function listMovements(q: MovementListQuery) {
  const filter: Record<string, unknown> = { ...beforeCursor(q.cursor) };
  if (q.productId) filter.product = oid(q.productId);
  if (q.type) filter.type = q.type;
  if (q.refType) filter.refType = q.refType;
  if (q.from || q.to) {
    filter.createdAt = {
      ...(filter.createdAt as object | undefined),
      ...(q.from ? { $gte: q.from } : {}),
      ...(q.to ? { $lte: q.to } : {}),
    };
  }
  const docs = await StockMovementModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1)
    .lean<(StockMovement & { _id: Types.ObjectId; createdAt: Date })[]>();
  const page = cursorPage(docs, q.limit);
  const productIds = [...new Set(page.items.map((m) => String(m.product)))].map(oid);
  const products = await ProductModel.find(
    { _id: { $in: productIds } },
    { sku: 1, name: 1 },
    { withDeleted: true },
  ).lean();
  return {
    ...page,
    products: new Map(products.map((p) => [String(p._id), { sku: p.sku, name: p.name }])),
  };
}

export { activeMatch };
