import type { Request } from 'express';
import { z } from 'zod';
import {
  batchListQuery,
  batchUpdateSchema,
  bulkPriceSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  comboSuggestionSchema,
  demandQuery,
  exportQuery,
  idParams,
  imagesReorderSchema,
  importQuery,
  lowStockQuery,
  movementListQuery,
  objectIdSchema,
  priceListQuery,
  productCreateSchema,
  productListQuery,
  productPriceSchema,
  productUpdateSchema,
  reorderSchema,
  stockMovementSchema,
  templateQuery,
  boolQuery,
} from '@sakthimaan/shared';
import { authOf } from '../middlewares/auth.js';
import { requestMeta } from '../middlewares/request-context.js';
import { validated } from '../middlewares/validate.js';
import { StockBatchModel } from '../models/index.js';
import { demandReport, listMovements, lowStockProducts } from '../repositories/catalog.repository.js';
import type { AuditActor, AuditService } from '../services/audit.service.js';
import type { CategoryService } from '../services/catalog/category.service.js';
import type { InventoryService } from '../services/catalog/inventory.service.js';
import { toMovementDto } from '../services/catalog/mappers.js';
import type { PriceListService } from '../services/catalog/price-list.service.js';
import type { ProductIoService } from '../services/catalog/product-io.service.js';
import type { ProductService } from '../services/catalog/product.service.js';
import { badRequest, forbidden, notFound } from '../utils/app-error.js';
import { sendCreated, sendFile, sendNoContent, sendOk } from '../utils/http.js';
import { oid } from '../utils/query.js';

export function actorOf(req: Request): AuditActor {
  const a = authOf(req);
  return { user: a.userId, name: a.name, role: a.role };
}

function uploadedFiles(req: Request): Buffer[] {
  const files = req.files;
  return Array.isArray(files) ? files.map((f) => f.buffer) : [];
}

// ------------------------------------------------------------------ categories

export function createCategoryController(categories: CategoryService) {
  return {
    tree: validated(
      { query: z.object({ includeInactive: boolQuery.default(true) }) },
      async ({ query }, _req, res) => {
        sendOk(res, await categories.tree({ includeInactive: query.includeInactive }));
      },
    ),
    get: validated({ params: idParams }, async ({ params }, _req, res) => {
      sendOk(res, await categories.get(params.id));
    }),
    create: validated({ body: categoryCreateSchema }, async ({ body }, req, res) => {
      sendCreated(res, await categories.create(body, actorOf(req), requestMeta(req)));
    }),
    update: validated(
      { params: idParams, body: categoryUpdateSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await categories.update(params.id, body, actorOf(req), requestMeta(req)));
      },
    ),
    reorder: validated({ body: reorderSchema }, async ({ body }, req, res) => {
      await categories.reorder(body, actorOf(req), requestMeta(req));
      sendNoContent(res);
    }),
    remove: validated({ params: idParams }, async ({ params }, req, res) => {
      await categories.remove(params.id, actorOf(req), requestMeta(req));
      sendNoContent(res);
    }),
    setImage: validated({ params: idParams }, async ({ params }, req, res) => {
      const [file] = uploadedFiles(req);
      if (!file) throw badRequest('VALIDATION_ERROR', 'Choose an image (field "files")');
      sendOk(res, await categories.setImage(params.id, file, actorOf(req), requestMeta(req)));
    }),
  };
}

// ------------------------------------------------------------------ products

export function createProductController(deps: {
  products: ProductService;
  io: ProductIoService;
  priceList: PriceListService;
}) {
  const { products, io, priceList } = deps;
  return {
    list: validated({ query: productListQuery }, async ({ query }, req, res) => {
      if (query.deleted && !authOf(req).permissions.has('products:delete')) {
        throw forbidden('Viewing deleted products needs products:delete', { missing: ['products:delete'] });
      }
      const { items, total } = await products.list(query);
      sendOk(res, items, { page: query.page, pageSize: query.pageSize, total });
    }),
    get: validated({ params: idParams }, async ({ params }, _req, res) => {
      sendOk(res, await products.get(params.id));
    }),
    create: validated({ body: productCreateSchema }, async ({ body }, req, res) => {
      sendCreated(res, await products.create(body, actorOf(req), requestMeta(req)));
    }),
    update: validated({ params: idParams, body: productUpdateSchema }, async ({ params, body }, req, res) => {
      sendOk(res, await products.update(params.id, body, actorOf(req), requestMeta(req)));
    }),
    updatePrice: validated(
      { params: idParams, body: productPriceSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await products.updatePrice(params.id, body, actorOf(req), requestMeta(req)));
      },
    ),
    bulkPrice: validated({ body: bulkPriceSchema }, async ({ body }, req, res) => {
      sendOk(res, await products.bulkPrice(body, actorOf(req), requestMeta(req)));
    }),
    remove: validated({ params: idParams }, async ({ params }, req, res) => {
      await products.remove(params.id, actorOf(req), requestMeta(req));
      sendNoContent(res);
    }),
    restore: validated({ params: idParams }, async ({ params }, req, res) => {
      sendOk(res, await products.restore(params.id, actorOf(req), requestMeta(req)));
    }),
    reorder: validated({ body: reorderSchema }, async ({ body }, req, res) => {
      await products.reorder(body, actorOf(req), requestMeta(req));
      sendNoContent(res);
    }),
    addImages: validated({ params: idParams }, async ({ params }, req, res) => {
      sendOk(res, await products.addImages(params.id, uploadedFiles(req), actorOf(req), requestMeta(req)));
    }),
    removeImage: validated(
      { params: z.strictObject({ id: objectIdSchema, key: z.string().min(1).max(300) }) },
      async ({ params }, req, res) => {
        sendOk(res, await products.removeImage(params.id, params.key, actorOf(req), requestMeta(req)));
      },
    ),
    reorderImages: validated(
      { params: idParams, body: imagesReorderSchema },
      async ({ params, body }, req, res) => {
        sendOk(res, await products.reorderImages(params.id, body, actorOf(req), requestMeta(req)));
      },
    ),
    comboSuggestion: validated({ body: comboSuggestionSchema }, async ({ body }, _req, res) => {
      sendOk(res, await products.comboSuggestion(body));
    }),
    priceList: validated({ query: priceListQuery }, async ({ query }, _req, res) => {
      const buffer = await priceList.render(query);
      const date = new Date().toISOString().slice(0, 10);
      sendFile(res, { buffer, filename: `price-list-${date}.pdf`, contentType: 'application/pdf' }, 'inline');
    }),
    export: validated({ query: exportQuery }, async ({ query }, _req, res) => {
      sendFile(res, await io.export(query));
    }),
    template: validated({ query: templateQuery }, async ({ query }, _req, res) => {
      sendFile(res, await io.template(query.format));
    }),
    import: validated({ query: importQuery }, async ({ query }, req, res) => {
      if (!req.file) throw badRequest('VALIDATION_ERROR', 'Choose a .csv or .xlsx file (field "file")');
      sendOk(res, await io.import(req.file, query, actorOf(req), requestMeta(req)));
    }),
  };
}

// ------------------------------------------------------------------ inventory

export function createInventoryController(
  inventory: InventoryService,
  products: ProductService,
  audit: AuditService,
) {
  return {
    recordMovement: validated({ body: stockMovementSchema }, async ({ body }, req, res) => {
      const outcome = await inventory.recordManual(body, actorOf(req), requestMeta(req));
      sendCreated(res, {
        productId: String(outcome.productId),
        sku: outcome.sku,
        stockBefore: outcome.stockBefore,
        stockAfter: outcome.stockAfter,
        stockVersion: outcome.stockVersion,
        movementIds: outcome.movementIds.map(String),
      });
    }),
    movements: validated({ query: movementListQuery }, async ({ query }, _req, res) => {
      const page = await listMovements(query);
      sendOk(
        res,
        page.items.map((m) => toMovementDto(m, page.products)),
        { nextCursor: page.nextCursor },
      );
    }),
    ledger: validated(
      { params: idParams, query: movementListQuery.omit({ productId: true }) },
      async ({ params, query }, _req, res) => {
        const product = await products.get(params.id, { withDeleted: true });
        const page = await listMovements({ ...query, productId: params.id });
        sendOk(
          res,
          {
            product: {
              id: product.id,
              sku: product.sku,
              name: product.name,
              stock: product.stock,
              stockVersion: product.stockVersion,
            },
            movements: page.items.map((m) => toMovementDto(m, page.products)),
          },
          { nextCursor: page.nextCursor },
        );
      },
    ),
    lowStock: validated({ query: lowStockQuery }, async ({ query }, _req, res) => {
      const { items, total } = await lowStockProducts(query);
      sendOk(res, await products.toDtos(items), { page: query.page, pageSize: query.pageSize, total });
    }),
    demand: validated({ query: demandQuery }, async ({ query }, _req, res) => {
      const { rows, total } = await demandReport(query);
      sendOk(res, rows, { page: query.page, pageSize: query.pageSize, total });
    }),
    batches: validated({ query: batchListQuery }, async ({ query }, _req, res) => {
      const filter: Record<string, unknown> = { product: oid(query.productId) };
      if (query.onlyAvailable) filter.qtyRemaining = { $gt: 0 };
      const batches = await StockBatchModel.find(filter).sort({ receivedAt: 1 }).lean();
      sendOk(
        res,
        batches.map((b) => ({
          id: String(b._id),
          productId: String(b.product),
          lotNumber: b.lotNumber,
          supplier: b.supplier ?? null,
          manufacturedAt: b.manufacturedAt?.toISOString() ?? null,
          receivedAt: b.receivedAt.toISOString(),
          qtyReceived: b.qtyReceived,
          qtyRemaining: b.qtyRemaining,
          costPrice: b.costPrice ?? null,
          notes: b.notes ?? null,
        })),
      );
    }),
    updateBatch: validated(
      { params: idParams, body: batchUpdateSchema },
      async ({ params, body }, req, res) => {
        const batch = await StockBatchModel.findByIdAndUpdate(
          params.id,
          { $set: body },
          { returnDocument: 'after', runValidators: true },
        ).lean();
        if (!batch) throw notFound('Batch');
        await audit.record(
          {
            actor: actorOf(req),
            action: 'update',
            entity: 'stock',
            entityId: String(batch.product),
            entityLabel: batch.lotNumber,
            summary: 'Batch details updated',
          },
          requestMeta(req),
        );
        sendOk(res, {
          id: String(batch._id),
          lotNumber: batch.lotNumber,
          supplier: batch.supplier ?? null,
          notes: batch.notes ?? null,
        });
      },
    ),
  };
}
