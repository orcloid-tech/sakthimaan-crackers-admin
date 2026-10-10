import { Router, type RequestHandler } from 'express';
import {
  batchUpdateSchema,
  bulkPriceSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  comboSuggestionSchema,
  demandQuery,
  exportQuery,
  imagesReorderSchema,
  importQuery,
  lowStockQuery,
  movementListQuery,
  priceListQuery,
  productCreateSchema,
  productListQuery,
  productPriceSchema,
  productUpdateSchema,
  reorderSchema,
  stockMovementSchema,
  templateQuery,
  type Permission,
} from '@sakthimaan/shared';
import type {
  createCategoryController,
  createInventoryController,
  createProductController,
} from '../../controllers/catalog.controller.js';
import { requirePermission } from '../../middlewares/auth.js';
import type { ApiDocs, RouteDoc } from '../../openapi/registry.js';

type Docs = Omit<RouteDoc, 'method' | 'path' | 'auth' | 'permissions' | 'tag'>;

/** Registers a route with its permission(s) and its OpenAPI entry in one place. */
function route(
  r: Router,
  docs: ApiDocs,
  base: string,
  tag: string,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  permissions: Permission[],
  handlers: RequestHandler[],
  doc: Docs,
): void {
  r[method](path, requirePermission(...permissions), ...handlers);
  docs.register({ ...doc, method, path: `${base}${path}`, tag, auth: 'bearer', permissions });
}

export function createCategoriesRouter(
  c: ReturnType<typeof createCategoryController>,
  docs: ApiDocs,
  upload: RequestHandler,
): Router {
  const r = Router();
  const add = (
    m: Parameters<typeof route>[4],
    p: string,
    perms: Permission[],
    h: RequestHandler[],
    d: Docs,
  ) => route(r, docs, '/api/v1/categories', 'Categories', m, p, perms, h, d);

  add('get', '/', ['categories:read'], [c.tree], { summary: 'Category tree with product counts' });
  add('post', '/', ['categories:manage'], [c.create], {
    summary: 'Create a category or sub-category',
    body: categoryCreateSchema,
  });
  add('patch', '/reorder', ['categories:manage'], [c.reorder], {
    summary: 'Set display order',
    body: reorderSchema,
  });
  add('get', '/:id', ['categories:read'], [c.get], { summary: 'Get a category' });
  add('patch', '/:id', ['categories:manage'], [c.update], {
    summary: 'Update a category (incl. HSN / GST overrides)',
    body: categoryUpdateSchema,
  });
  add('delete', '/:id', ['categories:manage'], [c.remove], {
    summary: 'Delete (soft) an empty category',
    responses: { 204: 'Deleted', 409: 'Has products or sub-categories' },
  });
  add('post', '/:id/image', ['categories:manage'], [upload, c.setImage], {
    summary: 'Upload the category image (multipart field "files")',
  });
  return r;
}

export function createProductsRouter(
  c: ReturnType<typeof createProductController>,
  docs: ApiDocs,
  uploads: { images: RequestHandler; spreadsheet: RequestHandler },
): Router {
  const r = Router();
  const add = (
    m: Parameters<typeof route>[4],
    p: string,
    perms: Permission[],
    h: RequestHandler[],
    d: Docs,
  ) => route(r, docs, '/api/v1/products', 'Products', m, p, perms, h, d);

  // Fixed paths before /:id
  add('get', '/', ['products:read'], [c.list], {
    summary: 'List products (search, filters, paging); includes pending enquiry demand',
    query: productListQuery,
  });
  add('post', '/', ['products:create'], [c.create], {
    summary: 'Create a product or gift box (optional opening stock)',
    body: productCreateSchema,
    responses: { 201: 'Created', 409: 'SKU already exists' },
  });
  add('get', '/export', ['products:export'], [c.export], {
    summary: 'Export products (CSV or Excel)',
    query: exportQuery,
  });
  add('get', '/price-list.pdf', ['products:export'], [c.priceList], {
    summary: 'Printable price list PDF',
    query: priceListQuery,
  });
  add('get', '/import/template', ['products:import'], [c.template], {
    summary: 'Download the import template (CSV or Excel with dropdowns and instructions)',
    query: templateQuery,
  });
  add('post', '/import', ['products:import', 'products:update_price'], [uploads.spreadsheet, c.import], {
    summary: 'Import products from CSV/Excel (dryRun=true first: row-by-row report, nothing saved)',
    query: importQuery,
    description:
      'All-or-nothing: with dryRun=false the import is applied in one transaction, or rejected (422) with the report.',
    responses: { 422: 'File has errors (report in error.details)' },
  });
  add('post', '/bulk-price', ['products:update_price'], [c.bulkPrice], {
    summary: 'Bulk price change (e.g. 80% on a category); dryRun previews',
    body: bulkPriceSchema,
  });
  add('patch', '/reorder', ['products:update'], [c.reorder], {
    summary: 'Set display order',
    body: reorderSchema,
  });
  add('post', '/combos/price-suggestion', ['products:read'], [c.comboSuggestion], {
    summary: 'Suggested gift box MRP / discount from its contents',
    body: comboSuggestionSchema,
  });

  add('get', '/:id', ['products:read'], [c.get], { summary: 'Get a product' });
  add('patch', '/:id', ['products:update'], [c.update], {
    summary: 'Update product details (not price or stock); send the current version',
    body: productUpdateSchema,
    responses: { 409: 'Changed by someone else (VERSION_CONFLICT)' },
  });
  add('patch', '/:id/price', ['products:update_price'], [c.updatePrice], {
    summary: 'Change MRP / discount / HSN / GST rate (audited)',
    body: productPriceSchema,
  });
  add('delete', '/:id', ['products:delete'], [c.remove], {
    summary: 'Delete (soft) a product',
    responses: { 204: 'Deleted', 409: 'Inside a gift box' },
  });
  add('post', '/:id/restore', ['products:delete'], [c.restore], { summary: 'Restore a deleted product' });
  add('post', '/:id/images', ['products:update'], [uploads.images, c.addImages], {
    summary: 'Upload images (multipart field "files", up to 8 per product)',
  });
  add('patch', '/:id/images', ['products:update'], [c.reorderImages], {
    summary: 'Reorder images (first = cover)',
    body: imagesReorderSchema,
  });
  add('delete', '/:id/images/:key', ['products:update'], [c.removeImage], { summary: 'Remove an image' });
  return r;
}

export function createInventoryRouter(
  c: ReturnType<typeof createInventoryController>,
  docs: ApiDocs,
): { inventory: Router; ledger: Router } {
  const r = Router();
  const add = (
    m: Parameters<typeof route>[4],
    p: string,
    perms: Permission[],
    h: RequestHandler[],
    d: Docs,
  ) => route(r, docs, '/api/v1/inventory', 'Inventory', m, p, perms, h, d);

  add('post', '/movements', ['inventory:adjust'], [c.recordMovement], {
    summary: 'Stock in / stock out / adjustment (physical count)',
    body: stockMovementSchema,
    description:
      'Adjustments set an absolute quantity and must send the stockVersion that was shown (409 VERSION_CONFLICT otherwise). ' +
      'Stock out fails with 409 INSUFFICIENT_STOCK if it would go below zero.',
    responses: { 201: 'Recorded', 409: 'Insufficient stock or version conflict' },
  });
  add('get', '/movements', ['inventory:read'], [c.movements], {
    summary: 'Stock ledger (all products)',
    query: movementListQuery,
  });
  add('get', '/low-stock', ['inventory:read'], [c.lowStock], {
    summary: 'Products at or below their alert level',
    query: lowStockQuery,
  });
  add('get', '/demand', ['inventory:read'], [c.demand], {
    summary: 'Pending enquiry demand vs stock per product',
    query: demandQuery,
  });
  add('get', '/batches', ['inventory:read'], [c.batches], { summary: 'Batches / lots of a product' });
  add('patch', '/batches/:id', ['inventory:adjust'], [c.updateBatch], {
    summary: 'Edit batch details',
    body: batchUpdateSchema,
  });

  const ledger = Router();
  ledger.get('/:id/stock-ledger', requirePermission('inventory:read'), c.ledger);
  docs.register({
    method: 'get',
    path: '/api/v1/products/:id/stock-ledger',
    tag: 'Inventory',
    auth: 'bearer',
    permissions: ['inventory:read'],
    summary: 'Stock ledger of one product',
    query: movementListQuery.omit({ productId: true }),
  });
  return { inventory: r, ledger };
}
