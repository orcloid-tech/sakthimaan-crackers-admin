import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ImportReport } from '@sakthimaan/shared';
import { AuditLogModel, CategoryModel, ProductModel, StockMovementModel } from '../../src/models/index.js';
import { buildTemplateCsv } from '../../src/services/catalog/spreadsheet.js';
import { buildTestApp, signedIn } from '../helpers/app.js';
import { clearCollections, useTestDb } from '../helpers/db.js';
import { makeCategory, makeProduct } from './fixtures.js';

useTestDb();
const { app } = buildTestApp();
let admin: Awaited<ReturnType<typeof signedIn>>;

const HEADER =
  'sku,name,category,sub_category,unit,contents_per_unit,mrp,discount_percent,hsn,gst_rate,opening_stock,low_stock_alert,green_cracker,sound_level,min_age,safety_warning,description,tags,video_url,active,featured,sort_order';
const csv = (...rows: string[]) => Buffer.from([HEADER, ...rows].join('\n'));

beforeAll(async () => {
  admin = await signedIn(app, 'admin');
});

async function upload(buffer: Buffer, query: string, filename = 'products.csv') {
  return admin.post(`/api/v1/products/import?${query}`).attach('file', buffer, filename);
}

describe('templates', () => {
  it('the CSV template committed in docs/templates matches the generator', () => {
    const committed = readFileSync(
      new URL('../../../../docs/templates/product-import-template.csv', import.meta.url),
    );
    expect(committed.equals(buildTemplateCsv())).toBe(true);
  });

  it('downloads CSV and Excel templates; the Excel one has dropdowns and instructions', async () => {
    await makeCategory(admin, { name: 'Sparklers' });
    const c = await admin.get('/api/v1/products/import/template?format=csv');
    expect(c.headers['content-type']).toMatch(/text\/csv/);
    expect(c.headers['content-disposition']).toMatch(/product-import-template\.csv/);

    const x = await admin
      .get('/api/v1/products/import/template?format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Products', 'Categories', 'Instructions']);
    const products = wb.getWorksheet('Products')!;
    expect(products.getRow(1).getCell(1).value).toBe('sku');
    expect(products.getCell('E2').dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"box,pkt,piece"'],
    });
    expect(wb.getWorksheet('Categories')!.getCell('A2').value).toBe('Sparklers');
  });

  it('a template uploaded as-is passes the dry run (with "create missing categories")', async () => {
    const res = await upload(buildTemplateCsv(), 'dryRun=true&createMissingCategories=true', 'template.csv');
    const report = res.body.data as ImportReport;
    expect(report.errors).toEqual([]);
    expect(report.toCreate).toBe(3);
  });
});

describe('import', () => {
  it('dry run: row-by-row report, nothing saved', async () => {
    await clearCollections('products', 'categories');
    await CategoryModel.create({ name: 'Sparklers', slug: 'sparklers' });
    const res = await upload(
      csv(
        'SP-1,7cm Sparkler,sparklers,,box,10,199,82.5,,,100,,yes,none,,,,,,yes,no,1',
        'SP-2,,Sparklers,,carton,10,abc,,,,,,,,,,,,,,,',
        'SP-1,Duplicate,Sparklers,,box,1,10,0,,,,,,,,,,,,,,',
        'RK-1,Rocket,Rockets,,pkt,10,750,80,,,,,,,,,,,,,,',
      ),
      'dryRun=true',
    );
    expect(res.status).toBe(200);
    const r = res.body.data as ImportReport;
    expect(r).toMatchObject({ dryRun: true, applied: false, totalRows: 4, toCreate: 1, toUpdate: 0 });
    expect(r.errors).toEqual(
      expect.arrayContaining([
        { row: 3, column: 'name', message: 'Required' },
        { row: 3, column: 'unit', message: expect.stringMatching(/box, pkt, piece/) as unknown },
        { row: 3, column: 'mrp', message: expect.stringMatching(/number/) as unknown },
        { row: 4, column: 'sku', message: 'Duplicate SKU (also on row 2)' },
        { row: 5, column: 'category', message: expect.stringMatching(/Rockets.*not found/) as unknown },
      ]),
    );
    expect(await ProductModel.countDocuments()).toBe(0);
  });

  it('refuses to apply a file with errors (422, nothing saved)', async () => {
    await clearCollections('products', 'categories');
    await CategoryModel.create({ name: 'Sparklers', slug: 'sparklers' });
    const res = await upload(
      csv('OK-1,Fine,Sparklers,,box,1,10,0,,,,,,,,,,,,,,', 'BAD-1,Bad,Sparklers,,box,1,-5,0,,,,,,,,,,,,,,'),
      'dryRun=false',
    );
    expect(res.status).toBe(422);
    expect((res.body.error.details as ImportReport).errors[0]).toMatchObject({ row: 3, column: 'mrp' });
    expect(await ProductModel.countDocuments()).toBe(0);
  });

  it('applies creates + updates in one go, with opening stock, missing categories and audit', async () => {
    await clearCollections('products', 'categories', 'stockmovements', 'auditlogs');
    const cat = await makeCategory(admin, { name: 'Flower Pots' });
    const existing = await makeProduct(admin, cat.id, {
      sku: 'FP-BIG',
      name: 'Flower Pot Big',
      mrp: 45_000,
      discountPct: 80,
      openingStock: 7,
    });
    const res = await upload(
      csv(
        'FP-BIG,Flower Pot Big,Flower Pots,,box,10,450,85,,,999,,yes,low,12,,,,,yes,no,1', // price change; stock ignored
        'GC-ASOKA,Ground Chakkar Asoka,Ground Chakkars,Big,box,10,"1,250",80,,18,40,15,no,medium,,,,wheel;kids,,yes,yes,2',
      ),
      'dryRun=false&createMissingCategories=true',
    );
    expect(res.status).toBe(200);
    const r = res.body.data as ImportReport;
    expect(r).toMatchObject({
      applied: true,
      toCreate: 1,
      toUpdate: 1,
      categoriesToCreate: ['Ground Chakkars', 'Ground Chakkars > Big'],
    });
    expect(r.warnings).toEqual([
      { row: 2, column: 'opening_stock', message: expect.stringMatching(/Ignored/) as unknown },
    ]);

    const updated = await ProductModel.findById(existing.id).lean();
    expect(updated).toMatchObject({
      discountPct: 85,
      netPrice: 6_800,
      stock: 7,
      isGreen: true,
      soundLevel: 'low',
      minAge: 12,
    });

    const created = await ProductModel.findOne({ sku: 'GC-ASOKA' }).lean();
    expect(created).toMatchObject({
      mrp: 125_000,
      netPrice: 25_000,
      taxRate: 18,
      stock: 40,
      lowStockThreshold: 15,
      tags: ['wheel', 'kids'],
    });
    const sub = await CategoryModel.findById(created?.subCategory).lean();
    expect(sub?.name).toBe('Big');
    expect(await StockMovementModel.findOne({ product: created?._id }).lean()).toMatchObject({
      refType: 'import',
      qty: 40,
    });

    expect(await AuditLogModel.countDocuments({ action: 'import' })).toBe(1);
    expect(
      await AuditLogModel.findOne({ action: 'price_change', entityId: existing.id }).lean(),
    ).toBeTruthy();

    // re-importing the same file changes nothing
    const again = await upload(
      csv('FP-BIG,Flower Pot Big,Flower Pots,,box,10,450,85,,,,,yes,low,12,,,,,yes,no,1'),
      'dryRun=true',
    );
    expect((again.body.data as ImportReport).unchanged).toBe(1);
  });

  it('reads Excel files and Excel-style CSVs (BOM, semicolons, quoted commas)', async () => {
    await clearCollections('products', 'categories');
    await CategoryModel.create({ name: 'Bombs', slug: 'bombs' });
    const semi = Buffer.from(
      String.fromCharCode(0xfeff) + 'sku;name;category;unit;mrp\r\nBM-1;"Atom Bomb, Big";Bombs;box;300\r\n',
    );
    const r1 = (await upload(semi, 'dryRun=true')).body.data as ImportReport;
    expect(r1.errors).toEqual([]);
    expect(r1.toCreate).toBe(1);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(['SKU', 'Name', 'Category', 'Unit', 'MRP', 'Discount Percent']);
    ws.addRow(['BM-2', 'Hydro Bomb', 'Bombs', 'box', 1299.5, 80]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const r2 = (await upload(xlsx, 'dryRun=false', 'products.xlsx')).body.data as ImportReport;
    expect(r2).toMatchObject({ applied: true, toCreate: 1 });
    expect(await ProductModel.findOne({ sku: 'BM-2' }).lean()).toMatchObject({
      mrp: 129_950,
      discountPct: 80,
      netPrice: 26_000,
    });
  });

  it('rejects wrong file types, missing columns and needs both import + price permissions', async () => {
    const txt = await admin.post('/api/v1/products/import').attach('file', Buffer.from('x'), 'notes.txt');
    expect(txt.status).toBe(400);
    const cols = await upload(Buffer.from('sku,name\nA,B\n'), 'dryRun=true');
    expect(cols.body.error.message).toMatch(/Missing required column\(s\): category, unit, mrp/);

    const inv = await signedIn(app, 'staff_inventory');
    const denied = await inv.post('/api/v1/products/import').attach('file', csv(), 'p.csv');
    expect(denied.status).toBe(403);
  });
});

describe('export', () => {
  it('exports CSV that round-trips through import, with formula injection neutralised', async () => {
    await clearCollections('products', 'categories');
    const cat = await makeCategory(admin, { name: 'Fancy' });
    await makeProduct(admin, cat.id, {
      sku: 'FN-1',
      name: '=HYPERLINK("http://evil")',
      mrp: 99_900,
      discountPct: 80,
    });
    const res = await admin.get('/api/v1/products/export?format=csv');
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text.split('\r\n')[0]).toMatch(/,net_price,current_stock$/);

    // the exported file imports back with no changes (the formula guard is undone on import)
    const back = (await upload(Buffer.from(text), 'dryRun=true', 'export.csv')).body.data as ImportReport;
    expect(back).toMatchObject({ errors: [], warnings: [], toCreate: 0, toUpdate: 0, unchanged: 1 });
  });

  it('exports Excel', async () => {
    const res = await admin.get('/api/v1/products/export?format=xlsx');
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/products-\d{4}-\d{2}-\d{2}\.xlsx/);
  });
});

describe('price list PDF', () => {
  it('renders an A4 PDF with categories, combos and many pages when needed', async () => {
    await clearCollections('products', 'categories');
    const cat = await makeCategory(admin, { name: 'Sparklers PDF' });
    const sub = await makeCategory(admin, { name: '10cm', parentId: cat.id });
    for (let i = 0; i < 70; i++) {
      await ProductModel.create({
        name: `Sparkler ${i}`,
        slug: `sparkler-pdf-${i}`,
        sku: `PDF-${i}`,
        category: cat.id,
        subCategory: i % 2 ? sub.id : null,
        unit: 'box',
        mrp: 19_900 + i * 100,
        discountPct: 80,
        stock: i % 10 === 0 ? 0 : 5,
        isGreen: i % 3 === 0,
      });
    }
    const res = await admin
      .get('/api/v1/products/price-list.pdf')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (d: Buffer) => chunks.push(d));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="price-list-/);
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(2);

    const inStockOnly = await admin.get('/api/v1/products/price-list.pdf?includeOutOfStock=false');
    expect(inStockOnly.status).toBe(200);
  });

  it('needs products:export', async () => {
    const staffOrders = await signedIn(app, 'staff_orders');
    expect((await staffOrders.get('/api/v1/products/price-list.pdf')).status).toBe(403);
  });
});
