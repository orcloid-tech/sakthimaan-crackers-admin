import type { AnyKeys, Types } from 'mongoose';
import {
  PRODUCT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_EXAMPLES,
  PRODUCT_IMPORT_HEADERS,
  computeNetPrice,
  parseImportRow,
  type ExportQuery,
  type ImportIssue,
  type ImportQuery,
  type ImportReport,
  type ImportRow,
} from '@sakthimaan/shared';
import type { RequestMeta } from '../../middlewares/request-context.js';
import { CategoryModel, ProductModel, pricingContext, type Product } from '../../models/index.js';
import { AppError, badRequest, conflict } from '../../utils/app-error.js';
import { oid, slugify } from '../../utils/query.js';
import { withTransaction } from '../../utils/transaction.js';
import { diffFields, type AuditActor, type AuditEntry, type AuditService } from '../audit.service.js';
import type { SettingsCache } from '../settings-cache.js';
import type { InventoryService } from './inventory.service.js';
import {
  EXPORT_ONLY_COLUMNS,
  buildProductsWorkbook,
  buildTemplateCsv,
  readSpreadsheet,
  writeCsv,
} from './spreadsheet.js';

const REQUIRED = PRODUCT_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key);
const KNOWN = new Set<string>([...PRODUCT_IMPORT_HEADERS, ...EXPORT_ONLY_COLUMNS]);
/** Fields an import row sets on an existing product (compared to decide create/update/unchanged). */
const UPDATABLE = [
  'name',
  'category',
  'subCategory',
  'unit',
  'contentsCount',
  'mrp',
  'discountPct',
  'netPrice',
  'hsn',
  'taxRate',
  'lowStockThreshold',
  'isGreen',
  'soundLevel',
  'minAge',
  'safetyWarning',
  'description',
  'tags',
  'videoUrl',
  'isActive',
  'isFeatured',
  'sortOrder',
];
const PRICE_PATHS = new Set(['mrp', 'discountPct', 'netPrice', 'hsn', 'taxRate']);

interface ExistingProduct {
  _id: Types.ObjectId;
  __v?: number;
  sku: string;
  type: string;
  [key: string]: unknown;
}

interface PlannedCategory {
  key: string;
  name: string;
  parentKey: string | null;
  id: Types.ObjectId | null;
}

export interface ProductIoDeps {
  audit: AuditService;
  inventory: InventoryService;
  settings: SettingsCache;
  maxRows: number;
}

export class ProductIoService {
  constructor(private readonly deps: ProductIoDeps) {}

  // ------------------------------------------------------------------ import

  async import(
    file: { buffer: Buffer; originalname: string },
    q: ImportQuery,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<ImportReport> {
    const sheet = await readSpreadsheet(file.buffer, file.originalname, this.deps.maxRows);
    const missing = REQUIRED.filter((c) => !sheet.headers.includes(c));
    if (missing.length > 0) {
      throw badRequest(
        'VALIDATION_ERROR',
        `Missing required column(s): ${missing.join(', ')}. Use the template.`,
      );
    }

    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const unknown = sheet.headers.filter((h) => h && !KNOWN.has(h));
    if (unknown.length > 0)
      warnings.push({ row: 1, message: `Ignored unknown column(s): ${unknown.join(', ')}` });

    // 1. Parse rows; reject duplicate SKUs within the file.
    const parsed: { rowNumber: number; row: ImportRow }[] = [];
    const firstRowBySku = new Map<string, number>();
    for (const r of sheet.rows) {
      const { value, issues } = parseImportRow(r.values);
      issues.forEach((i) => errors.push({ row: r.rowNumber, column: i.column, message: i.message }));
      if (!value) continue;
      const seen = firstRowBySku.get(value.sku);
      if (seen) {
        errors.push({ row: r.rowNumber, column: 'sku', message: `Duplicate SKU (also on row ${seen})` });
        continue;
      }
      firstRowBySku.set(value.sku, r.rowNumber);
      parsed.push({ rowNumber: r.rowNumber, row: value });
    }

    // 2. Resolve categories by name (case-insensitive), planning creations if allowed.
    const categories = await this.planCategories(parsed, q.createMissingCategories, errors);

    // 3. Plan creates / updates against existing (non-deleted) products.
    const existing = await ProductModel.find({ sku: { $in: parsed.map((p) => p.row.sku) } }).lean<
      ExistingProduct[]
    >();
    const bySku = new Map(existing.map((e) => [e.sku, e]));
    const lowStockDefault = await this.deps.settings.lowStockDefault();
    const mode = pricingContext.roundingMode;

    const creates: { rowNumber: number; row: ImportRow; doc: Record<string, unknown> }[] = [];
    const updates: {
      rowNumber: number;
      current: ExistingProduct;
      set: Record<string, unknown>;
      changes: ReturnType<typeof diffFields>;
    }[] = [];
    const rowsOut: ImportReport['rows'] = [];
    const erroredRows = new Set(errors.map((e) => e.row));

    for (const { rowNumber, row } of parsed) {
      const cat = categories.get(row.category.toLowerCase());
      const sub = row.subCategory
        ? categories.get(`${row.category.toLowerCase()}>${row.subCategory.toLowerCase()}`)
        : null;
      if (erroredRows.has(rowNumber) || !cat || (row.subCategory && !sub)) {
        rowsOut.push({ row: rowNumber, sku: row.sku, action: 'error' });
        continue;
      }
      const fields = {
        name: row.name,
        unit: row.unit,
        contentsCount: row.contentsCount,
        mrp: row.mrp,
        discountPct: row.discountPct,
        netPrice: computeNetPrice(row.mrp, row.discountPct, mode),
        hsn: row.hsn,
        taxRate: row.taxRate,
        isGreen: row.isGreen,
        soundLevel: row.soundLevel,
        minAge: row.minAge,
        safetyWarning: row.safetyWarning,
        description: row.description,
        tags: row.tags,
        videoUrl: row.videoUrl,
        isActive: row.isActive,
        isFeatured: row.isFeatured,
        sortOrder: row.sortOrder,
      };

      const current = bySku.get(row.sku);
      if (!current) {
        creates.push({
          rowNumber,
          row,
          doc: {
            ...fields,
            sku: row.sku,
            type: 'single',
            lowStockThreshold: row.lowStockThreshold ?? lowStockDefault,
            catKey: cat.key,
            subKey: sub?.key ?? null,
          },
        });
        rowsOut.push({ row: rowNumber, sku: row.sku, action: 'create' });
        continue;
      }
      if (current.type === 'combo') {
        errors.push({
          row: rowNumber,
          column: 'sku',
          message: 'This SKU is a gift box; edit gift boxes in the admin panel',
        });
        rowsOut.push({ row: rowNumber, sku: row.sku, action: 'error' });
        continue;
      }
      if (row.openingStock > 0) {
        warnings.push({
          row: rowNumber,
          column: 'opening_stock',
          message: 'Ignored for existing products (use Inventory → Stock in)',
        });
      }
      if (!q.updateExisting) {
        warnings.push({
          row: rowNumber,
          column: 'sku',
          message: 'Already exists; skipped (updates are turned off)',
        });
        rowsOut.push({ row: rowNumber, sku: row.sku, action: 'unchanged' });
        continue;
      }
      const set: Record<string, unknown> = {
        ...fields,
        category: cat.id,
        subCategory: sub?.id ?? null,
        ...(row.lowStockThreshold !== null ? { lowStockThreshold: row.lowStockThreshold } : {}),
      };
      // New categories have no id yet, so compare by key for them.
      const comparable = {
        ...set,
        category: cat.id ?? `new:${cat.key}`,
        subCategory: sub ? (sub.id ?? `new:${sub.key}`) : null,
      };
      const changes = diffFields(
        normalizeForDiff(current),
        normalizeForDiff(comparable),
        UPDATABLE.filter((k) => k in comparable),
      );
      if (changes.length === 0) {
        rowsOut.push({ row: rowNumber, sku: row.sku, action: 'unchanged' });
      } else {
        updates.push({
          rowNumber,
          current,
          set: { ...set, catKey: cat.key, subKey: sub?.key ?? null },
          changes,
        });
        rowsOut.push({ row: rowNumber, sku: row.sku, action: 'update' });
      }
    }

    const report: ImportReport = {
      dryRun: q.dryRun,
      applied: false,
      totalRows: sheet.rows.length,
      toCreate: creates.length,
      toUpdate: updates.length,
      unchanged: rowsOut.filter((r) => r.action === 'unchanged').length,
      categoriesToCreate: [...categories.values()]
        .filter((c) => !c.id)
        .map((c) => (c.parentKey ? `${categories.get(c.parentKey)?.name} > ${c.name}` : c.name)),
      errors: errors.sort((a, b) => a.row - b.row),
      warnings,
      rows: rowsOut.sort((a, b) => a.row - b.row),
    };
    if (q.dryRun) return report;
    if (errors.length > 0) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'The file has errors. Nothing was imported; fix them and upload again.',
        report,
      );
    }
    if (creates.length === 0 && updates.length === 0) return { ...report, applied: true };

    await withTransaction(async (session) => {
      // Categories first (parents before children).
      const planned = [...categories.values()]
        .filter((c) => !c.id)
        .sort((a, b) => Number(a.parentKey !== null) - Number(b.parentKey !== null));
      for (const c of planned) {
        const parentId = c.parentKey ? categories.get(c.parentKey)?.id : null;
        const [created] = await CategoryModel.create(
          [
            {
              name: c.name,
              slug: await this.uniqueCategorySlug(
                slugify(c.parentKey ? `${categories.get(c.parentKey)?.name}-${c.name}` : c.name),
              ),
              parent: parentId ?? null,
            },
          ],
          { session },
        );
        c.id = created?._id ?? null;
      }
      const idOf = (key: string | null) => (key ? (categories.get(key)?.id ?? null) : null);

      // New products (create() runs the schema hooks), then their opening stock.
      const slugs = await this.uniqueProductSlugs(creates.map((c) => c.row.name));
      const newDocs: AnyKeys<Product>[] = creates.map((c, i) => {
        const { catKey, subKey, ...doc } = c.doc as Record<string, unknown> & {
          catKey: string;
          subKey: string | null;
        };
        return {
          ...(doc as AnyKeys<Product>),
          slug: slugs[i],
          category: idOf(catKey) ?? undefined,
          subCategory: idOf(subKey),
          stock: 0,
          createdBy: actor.user ? oid(actor.user) : undefined,
        };
      });
      const createdDocs = await ProductModel.create(newDocs, { session, ordered: true });
      for (const [i, doc] of createdDocs.entries()) {
        const qty = creates[i]?.row.openingStock ?? 0;
        if (qty > 0) {
          await this.deps.inventory.apply(
            {
              productId: doc._id,
              type: 'stock_in',
              qty,
              reason: 'Opening stock (import)',
              refType: 'import',
              refLabel: file.originalname.slice(0, 100),
            },
            actor,
            session,
          );
        }
      }

      // Updates: only if the product hasn't changed since it was read.
      if (updates.length > 0) {
        const res = await ProductModel.bulkWrite(
          updates.map((u) => {
            const { catKey, subKey, ...set } = u.set as Record<string, unknown> & {
              catKey: string;
              subKey: string | null;
            };
            return {
              updateOne: {
                filter: { _id: u.current._id, __v: u.current.__v ?? 0, isDeleted: false },
                update: {
                  $set: {
                    ...set,
                    category: idOf(catKey),
                    subCategory: idOf(subKey),
                    updatedBy: actor.user ? oid(actor.user) : undefined,
                  },
                  $inc: { __v: 1 },
                },
              },
            };
          }),
          { session, ordered: true },
        );
        if (res.matchedCount !== updates.length) {
          throw conflict(
            'VERSION_CONFLICT',
            'Some products were edited while importing. Run the import again.',
          );
        }
      }

      const entries: AuditEntry[] = [
        {
          actor,
          action: 'import',
          entity: 'product',
          summary: `Imported ${file.originalname}: ${creates.length} created, ${updates.length} updated`,
          meta: {
            file: file.originalname,
            created: creates.length,
            updated: updates.length,
            categoriesCreated: planned.map((c) => c.name),
          },
        },
        ...createdDocs.map((d) => ({
          actor,
          action: 'create' as const,
          entity: 'product' as const,
          entityId: String(d._id),
          entityLabel: d.sku,
          meta: { source: 'import' },
        })),
        ...updates.map((u) => ({
          actor,
          action: u.changes.some((c) => PRICE_PATHS.has(c.path))
            ? ('price_change' as const)
            : ('update' as const),
          entity: 'product' as const,
          entityId: String(u.current._id),
          entityLabel: u.current.sku,
          summary: 'Updated by import',
          changes: u.changes,
        })),
      ];
      await this.deps.audit.recordMany(entries, meta, session);
    });
    return { ...report, applied: true };
  }

  // ------------------------------------------------------------------ export / templates

  async export(q: ExportQuery): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const filter: Record<string, unknown> = { type: 'single' };
    if (!q.includeInactive) filter.isActive = true;
    if (q.categoryId) filter.$or = [{ category: oid(q.categoryId) }, { subCategory: oid(q.categoryId) }];
    const [products, cats] = await Promise.all([
      ProductModel.find(filter).sort({ sortOrder: 1, sku: 1 }).lean(),
      CategoryModel.find({}, { name: 1 }, { withDeleted: true }).lean(),
    ]);
    const catName = new Map(cats.map((c) => [String(c._id), c.name]));
    const rupees = (p: number) => String(p / 100);
    const yesNo = (b: boolean) => (b ? 'yes' : 'no');
    const rows = products.map((p) => ({
      sku: p.sku,
      name: p.name,
      category: catName.get(String(p.category)) ?? '',
      sub_category: p.subCategory ? (catName.get(String(p.subCategory)) ?? '') : '',
      unit: p.unit,
      contents_per_unit: String(p.contentsCount ?? 1),
      mrp: rupees(p.mrp),
      discount_percent: String(p.discountPct),
      hsn: p.hsn ?? '',
      gst_rate: p.taxRate == null ? '' : String(p.taxRate),
      opening_stock: '',
      low_stock_alert: String(p.lowStockThreshold ?? ''),
      green_cracker: yesNo(p.isGreen),
      sound_level: p.soundLevel ?? 'none',
      min_age: p.minAge == null ? '' : String(p.minAge),
      safety_warning: p.safetyWarning ?? '',
      description: p.description ?? '',
      tags: p.tags.join(';'),
      video_url: p.videoUrl ?? '',
      active: yesNo(p.isActive),
      featured: yesNo(p.isFeatured),
      sort_order: String(p.sortOrder),
      net_price: rupees(p.netPrice),
      current_stock: String(p.stock),
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'csv') {
      return {
        buffer: writeCsv([...PRODUCT_IMPORT_HEADERS, ...EXPORT_ONLY_COLUMNS], rows),
        filename: `products-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }
    const buffer = await buildProductsWorkbook({
      rows,
      extraColumns: EXPORT_ONLY_COLUMNS,
      categories: await this.categoryNames(),
      withInstructions: true,
    });
    return {
      buffer,
      filename: `products-${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async template(format: 'csv' | 'xlsx'): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    if (format === 'csv') {
      return {
        buffer: buildTemplateCsv(),
        filename: 'product-import-template.csv',
        contentType: 'text/csv; charset=utf-8',
      };
    }
    const buffer = await buildProductsWorkbook({
      rows: PRODUCT_IMPORT_EXAMPLES,
      categories: await this.categoryNames(),
      withInstructions: true,
    });
    return {
      buffer,
      filename: 'product-import-template.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ------------------------------------------------------------------ helpers

  private async categoryNames(): Promise<string[]> {
    const cats = await CategoryModel.find({ parent: null })
      .sort({ sortOrder: 1, name: 1 })
      .select('name')
      .lean();
    return cats.map((c) => c.name);
  }

  private async planCategories(
    parsed: { rowNumber: number; row: ImportRow }[],
    createMissing: boolean,
    errors: ImportIssue[],
  ): Promise<Map<string, PlannedCategory>> {
    const all = await CategoryModel.find({}, { name: 1, parent: 1 }).lean();
    const plan = new Map<string, PlannedCategory>();
    const topById = new Map<string, string>();
    for (const c of all.filter((c) => !c.parent)) {
      const key = c.name.toLowerCase();
      plan.set(key, { key, name: c.name, parentKey: null, id: c._id });
      topById.set(String(c._id), key);
    }
    for (const c of all.filter((c) => c.parent)) {
      const parentKey = topById.get(String(c.parent));
      if (!parentKey) continue;
      const key = `${parentKey}>${c.name.toLowerCase()}`;
      plan.set(key, { key, name: c.name, parentKey, id: c._id });
    }
    for (const { rowNumber, row } of parsed) {
      const catKey = row.category.toLowerCase();
      if (!plan.has(catKey)) {
        if (createMissing) plan.set(catKey, { key: catKey, name: row.category, parentKey: null, id: null });
        else
          errors.push({
            row: rowNumber,
            column: 'category',
            message: `Category "${row.category}" not found (or allow creating missing categories)`,
          });
      }
      if (row.subCategory && plan.has(catKey)) {
        const subKey = `${catKey}>${row.subCategory.toLowerCase()}`;
        if (!plan.has(subKey)) {
          if (createMissing)
            plan.set(subKey, { key: subKey, name: row.subCategory, parentKey: catKey, id: null });
          else
            errors.push({
              row: rowNumber,
              column: 'sub_category',
              message: `Sub-category "${row.subCategory}" not found under ${row.category}`,
            });
        }
      }
    }
    return plan;
  }

  private async uniqueCategorySlug(base: string): Promise<string> {
    const root = base || 'category';
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? root : `${root}-${i}`;
      if (!(await CategoryModel.exists({ slug: candidate }))) return candidate;
    }
    return `${root}-${Date.now()}`;
  }

  /** Unique slugs for a batch of new products (against the DB and each other). */
  private async uniqueProductSlugs(names: string[]): Promise<string[]> {
    const bases = names.map((n) => slugify(n) || 'product');
    const taken = new Set(
      (
        await ProductModel.find(
          {
            slug: {
              $regex: `^(${[...new Set(bases)].map((b) => b.replace(/[-]/g, '\\-')).join('|')})(-\\d+)?$`,
            },
          },
          { slug: 1 },
        ).lean()
      ).map((p) => p.slug),
    );
    return bases.map((base) => {
      let candidate = base;
      for (let i = 2; taken.has(candidate); i++) candidate = `${base}-${i}`;
      taken.add(candidate);
      return candidate;
    });
  }
}

/** Makes DB values and parsed values comparable (ObjectIds as strings, undefined as null). */
function normalizeForDiff(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of UPDATABLE) {
    const v = obj[k];
    out[k] =
      v === undefined || v === ''
        ? null
        : typeof v === 'object' && v !== null && 'toHexString' in v
          ? (v as { toHexString(): string }).toHexString()
          : v;
  }
  return out;
}
