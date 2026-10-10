import type { ClientSession, Types } from 'mongoose';
import type { StockMovementInput, StockMovementType } from '@sakthimaan/shared';
import type { RequestMeta } from '../../middlewares/request-context.js';
import { ProductModel, StockBatchModel, StockMovementModel } from '../../models/index.js';
import { type AppError, badRequest, conflict, notFound } from '../../utils/app-error.js';
import { oid } from '../../utils/query.js';
import { withTransaction } from '../../utils/transaction.js';
import type { AuditActor, AuditService } from '../audit.service.js';

export interface BatchAllocation {
  batchId: Types.ObjectId;
  qty: number;
}

export interface MovementRequest {
  productId: string | Types.ObjectId;
  type: StockMovementType;
  /** Positive quantity for in/out types; ignored for `adjustment`. */
  qty?: number;
  /** `adjustment` only. */
  newStock?: number;
  expectedStockVersion?: number;
  reason?: string;
  refType: 'order' | 'import' | 'manual';
  refId?: Types.ObjectId | null;
  refLabel?: string;
  /** stock_in of a batch-tracked product. */
  lot?: { lotNumber: string; supplier?: string; manufacturedAt?: Date; costPrice?: number };
  /** Take from / adjust this batch instead of FIFO. */
  batchId?: string;
  /** order_restock of a batch-tracked product: put back exactly what was taken. */
  restoreAllocations?: BatchAllocation[];
}

export interface MovementOutcome {
  productId: Types.ObjectId;
  sku: string;
  name: string;
  stockBefore: number;
  stockAfter: number;
  stockVersion: number;
  movementIds: Types.ObjectId[];
  allocations: BatchAllocation[];
}

const INCREASE: readonly StockMovementType[] = ['stock_in', 'order_restock'];
const DECREASE: readonly StockMovementType[] = ['stock_out', 'order_deduct'];

interface ProductStockView {
  _id: Types.ObjectId;
  sku: string;
  name: string;
  stock: number;
  stockVersion: number;
  trackBatches: boolean;
}

const STOCK_FIELDS = 'sku name stock stockVersion trackBatches';

/**
 * The only code path that changes stock. Every change, whether manual, import or order:
 * - updates `product.stock` atomically (decreases are conditional on `stock >= qty`,
 *   so stock can never go negative even under concurrent orders),
 * - bumps `stockVersion` (optimistic concurrency for absolute adjustments),
 * - keeps batch quantities in step (FIFO by receivedAt) for batch-tracked products,
 * - appends ledger rows whose balances chain exactly,
 * all inside the caller's transaction.
 */
export class InventoryService {
  constructor(private readonly audit: AuditService) {}

  /** Manual movement from the Inventory screen: own transaction + audit entry. */
  async recordManual(
    input: StockMovementInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<MovementOutcome> {
    return withTransaction(async (session) => {
      const outcome = await this.apply(this.toRequest(input), actor, session);
      await this.audit.record(
        {
          actor,
          action: 'stock_change',
          entity: 'stock',
          entityId: String(outcome.productId),
          entityLabel: outcome.sku,
          summary: `${input.type.replace('_', ' ')}: ${outcome.stockBefore} → ${outcome.stockAfter}`,
          changes: [{ path: 'stock', from: outcome.stockBefore, to: outcome.stockAfter }],
          meta: { type: input.type, reason: input.reason ?? null },
        },
        meta,
        session,
      );
      return outcome;
    });
  }

  async apply(req: MovementRequest, actor: AuditActor, session: ClientSession): Promise<MovementOutcome> {
    if (req.type === 'adjustment') return this.adjust(req, actor, session);
    const qty = req.qty ?? 0;
    if (!Number.isSafeInteger(qty) || qty < 1)
      throw badRequest('VALIDATION_ERROR', 'Quantity must be at least 1');
    if (INCREASE.includes(req.type)) return this.increase(req, qty, actor, session);
    if (DECREASE.includes(req.type)) return this.decrease(req, qty, actor, session);
    throw badRequest('VALIDATION_ERROR', `Unsupported movement type ${req.type}`);
  }

  // ------------------------------------------------------------------ increase

  private async increase(req: MovementRequest, qty: number, actor: AuditActor, session: ClientSession) {
    const product = await this.loadForUpdate(req, session);
    if (product.trackBatches && req.type === 'stock_in' && !req.lot) {
      throw badRequest('VALIDATION_ERROR', `${product.sku} tracks batches: enter a lot number`, [
        {
          location: 'body',
          path: 'lotNumber',
          message: 'Lot number is required for this product',
          code: 'custom',
        },
      ]);
    }

    const after = await ProductModel.findOneAndUpdate(
      { _id: product._id },
      { $inc: { stock: qty, stockVersion: 1 } },
      { session, returnDocument: 'after', projection: STOCK_FIELDS, withDeleted: true },
    ).lean<ProductStockView>();
    if (!after) throw notFound('Product');

    let allocations: BatchAllocation[] = [];
    if (product.trackBatches) {
      if (req.lot) {
        const batch = await StockBatchModel.findOneAndUpdate(
          { product: product._id, lotNumber: req.lot.lotNumber.toUpperCase() },
          {
            $inc: { qtyReceived: qty, qtyRemaining: qty },
            $setOnInsert: {
              receivedAt: new Date(),
              supplier: req.lot.supplier,
              manufacturedAt: req.lot.manufacturedAt,
              costPrice: req.lot.costPrice,
            },
          },
          { session, upsert: true, returnDocument: 'after', runValidators: true },
        ).lean();
        allocations = batch ? [{ batchId: batch._id, qty }] : [];
      } else if (req.restoreAllocations?.length) {
        for (const a of req.restoreAllocations) {
          await StockBatchModel.updateOne({ _id: a.batchId }, { $inc: { qtyRemaining: a.qty } }, { session });
        }
        allocations = req.restoreAllocations;
      }
    }

    const movementIds = await this.writeLedger(
      req,
      after,
      after.stock - qty,
      allocations,
      qty,
      actor,
      session,
    );
    return this.outcome(after, after.stock - qty, movementIds, allocations);
  }

  // ------------------------------------------------------------------ decrease

  private async decrease(req: MovementRequest, qty: number, actor: AuditActor, session: ClientSession) {
    const product = await this.loadForUpdate(req, session);
    const after = await ProductModel.findOneAndUpdate(
      { _id: product._id, stock: { $gte: qty } },
      { $inc: { stock: -qty, stockVersion: 1 } },
      { session, returnDocument: 'after', projection: STOCK_FIELDS, withDeleted: true },
    ).lean<ProductStockView>();
    if (!after) {
      throw conflict('INSUFFICIENT_STOCK', `Not enough stock for ${product.sku}`, {
        items: [
          {
            productId: String(product._id),
            sku: product.sku,
            name: product.name,
            requested: qty,
            available: product.stock,
            shortBy: qty - product.stock,
          },
        ],
      });
    }

    const allocations = product.trackBatches
      ? await this.takeFromBatches(product, qty, req.batchId, session)
      : [];
    const movementIds = await this.writeLedger(
      req,
      after,
      after.stock + qty,
      allocations,
      -qty,
      actor,
      session,
    );
    return this.outcome(after, after.stock + qty, movementIds, allocations);
  }

  /** FIFO (oldest received first) unless a specific batch is chosen. */
  private async takeFromBatches(
    product: ProductStockView,
    qty: number,
    batchId: string | undefined,
    session: ClientSession,
  ): Promise<BatchAllocation[]> {
    if (batchId) {
      const res = await StockBatchModel.updateOne(
        { _id: oid(batchId), product: product._id, qtyRemaining: { $gte: qty } },
        { $inc: { qtyRemaining: -qty } },
        { session },
      );
      if (res.modifiedCount !== 1) {
        throw conflict('INSUFFICIENT_STOCK', `Batch does not have ${qty} left for ${product.sku}`);
      }
      return [{ batchId: oid(batchId), qty }];
    }

    const batches = await StockBatchModel.find({ product: product._id, qtyRemaining: { $gt: 0 } })
      .sort({ receivedAt: 1, _id: 1 })
      .session(session)
      .lean();
    const allocations: BatchAllocation[] = [];
    let remaining = qty;
    for (const b of batches) {
      if (remaining === 0) break;
      const take = Math.min(b.qtyRemaining, remaining);
      allocations.push({ batchId: b._id, qty: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw conflict(
        'INSUFFICIENT_STOCK',
        `Batch quantities for ${product.sku} don't cover ${qty}. Correct the batches with an adjustment first.`,
      );
    }
    for (const a of allocations) {
      await StockBatchModel.updateOne({ _id: a.batchId }, { $inc: { qtyRemaining: -a.qty } }, { session });
    }
    return allocations;
  }

  // ------------------------------------------------------------------ adjustment

  private async adjust(req: MovementRequest, actor: AuditActor, session: ClientSession) {
    const newStock = req.newStock;
    if (newStock === undefined || req.expectedStockVersion === undefined) {
      throw badRequest('VALIDATION_ERROR', 'newStock and expectedStockVersion are required');
    }
    const product = await this.loadForUpdate(req, session);
    if (product.stockVersion !== req.expectedStockVersion) throw this.versionConflict(product);
    const delta = newStock - product.stock;
    if (delta === 0) throw badRequest('VALIDATION_ERROR', 'Stock is already at that quantity');

    const after = await ProductModel.findOneAndUpdate(
      { _id: product._id, stockVersion: req.expectedStockVersion },
      { $set: { stock: newStock }, $inc: { stockVersion: 1 } },
      { session, returnDocument: 'after', projection: STOCK_FIELDS },
    ).lean<ProductStockView>();
    if (!after) throw this.versionConflict(product);

    let allocations: BatchAllocation[] = [];
    if (product.trackBatches) {
      if (!req.batchId) {
        throw badRequest('VALIDATION_ERROR', `${product.sku} tracks batches: choose the batch to adjust`, [
          {
            location: 'body',
            path: 'batchId',
            message: 'Batch is required for this product',
            code: 'custom',
          },
        ]);
      }
      const res = await StockBatchModel.updateOne(
        { _id: oid(req.batchId), product: product._id, qtyRemaining: { $gte: Math.max(0, -delta) } },
        { $inc: { qtyRemaining: delta } },
        { session },
      );
      if (res.modifiedCount !== 1) throw conflict('INSUFFICIENT_STOCK', 'That batch cannot go below zero');
      allocations = [{ batchId: oid(req.batchId), qty: Math.abs(delta) }];
    }

    const movementIds = await this.writeLedger(req, after, product.stock, allocations, delta, actor, session);
    return this.outcome(after, product.stock, movementIds, allocations);
  }

  private versionConflict(p: ProductStockView): AppError {
    return conflict(
      'VERSION_CONFLICT',
      `Stock of ${p.sku} changed while you were editing (now ${p.stock}). Reload and try again.`,
      { currentStock: p.stock, currentStockVersion: p.stockVersion },
    );
  }

  // ------------------------------------------------------------------ helpers

  private async loadForUpdate(req: MovementRequest, session: ClientSession): Promise<ProductStockView> {
    // Order restocks must work even if the product was deleted after the order.
    const product = await ProductModel.findById(req.productId, STOCK_FIELDS, {
      session,
      withDeleted: req.refType === 'order',
    }).lean<ProductStockView>();
    if (!product) throw notFound('Product');
    return product;
  }

  /**
   * One ledger row per batch allocation (or one row without batch), with balances
   * chaining from `stockBefore` so the ledger always reconciles with product.stock.
   */
  private async writeLedger(
    req: MovementRequest,
    product: ProductStockView,
    stockBefore: number,
    allocations: BatchAllocation[],
    signedQty: number,
    actor: AuditActor,
    session: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const sign = signedQty < 0 ? -1 : 1;
    const parts =
      allocations.length > 1
        ? allocations.map((a) => ({ batch: a.batchId, qty: sign * a.qty }))
        : [{ batch: allocations[0]?.batchId ?? null, qty: signedQty }];
    let balance = stockBefore;
    const rows = parts.map((p) => {
      const row = {
        product: product._id,
        batch: p.batch,
        type: req.type,
        qty: p.qty,
        balanceBefore: balance,
        balanceAfter: balance + p.qty,
        reason: req.reason,
        refType: req.refType,
        refId: req.refId ?? null,
        refLabel: req.refLabel,
        actor: { user: actor.user, name: actor.name, role: actor.role },
      };
      balance += p.qty;
      return row;
    });
    const created = await StockMovementModel.create(rows, { session, ordered: true });
    return created.map((d) => d._id);
  }

  private outcome(
    after: ProductStockView,
    stockBefore: number,
    movementIds: Types.ObjectId[],
    allocations: BatchAllocation[],
  ): MovementOutcome {
    return {
      productId: after._id,
      sku: after.sku,
      name: after.name,
      stockBefore,
      stockAfter: after.stock,
      stockVersion: after.stockVersion,
      movementIds,
      allocations,
    };
  }

  private toRequest(input: StockMovementInput): MovementRequest {
    switch (input.type) {
      case 'stock_in':
        return {
          productId: input.productId,
          type: 'stock_in',
          qty: input.qty,
          reason: input.reason ?? 'Stock received',
          refType: 'manual',
          ...(input.lotNumber
            ? {
                lot: {
                  lotNumber: input.lotNumber,
                  supplier: input.supplier,
                  manufacturedAt: input.manufacturedAt,
                  costPrice: input.costPrice,
                },
              }
            : {}),
        };
      case 'stock_out':
        return {
          productId: input.productId,
          type: 'stock_out',
          qty: input.qty,
          reason: input.reason,
          refType: 'manual',
          batchId: input.batchId,
        };
      case 'adjustment':
        return {
          productId: input.productId,
          type: 'adjustment',
          newStock: input.newStock,
          expectedStockVersion: input.expectedStockVersion,
          reason: input.reason,
          refType: 'manual',
          batchId: input.batchId,
        };
    }
  }
}
