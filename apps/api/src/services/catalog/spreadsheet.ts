import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  PRODUCT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_EXAMPLES,
  PRODUCT_IMPORT_HEADERS,
  normalizeImportHeader,
  safeSpreadsheetCell,
} from '@sakthimaan/shared';
import { badRequest } from '../../utils/app-error.js';

export interface SheetRow {
  /** Row number as shown in Excel (header = 1). */
  rowNumber: number;
  values: Record<string, string>;
}

export interface ParsedSheet {
  headers: string[];
  rows: SheetRow[];
}

/** Read-only columns included in exports; silently ignored on import. */
export const EXPORT_ONLY_COLUMNS = ['net_price', 'current_stock'] as const;

export const PRODUCTS_SHEET = 'Products';

/** UTF-8 byte order mark: makes Excel read CSV files as UTF-8 (₹, Tamil text). */
const BOM = String.fromCharCode(0xfeff);

// ------------------------------------------------------------------ reading

export async function readSpreadsheet(
  buffer: Buffer,
  filename: string,
  maxRows: number,
): Promise<ParsedSheet> {
  const matrix = filename.toLowerCase().endsWith('.xlsx') ? await readXlsx(buffer) : readCsv(buffer);
  const [headerRow, ...body] = matrix;
  if (!headerRow || headerRow.every((h) => !h.trim()))
    throw badRequest('VALIDATION_ERROR', 'The file is empty');
  const headers = headerRow.map(normalizeImportHeader);

  const rows: SheetRow[] = [];
  body.forEach((cells, i) => {
    if (cells.every((c) => !c.trim())) return; // skip blank lines
    const values: Record<string, string> = {};
    headers.forEach((h, col) => {
      if (h) values[h] = cells[col] ?? '';
    });
    rows.push({ rowNumber: i + 2, values });
  });
  if (rows.length === 0) throw badRequest('VALIDATION_ERROR', 'No product rows found under the header row');
  if (rows.length > maxRows) {
    throw badRequest(
      'VALIDATION_ERROR',
      `Too many rows (${rows.length}). Upload at most ${maxRows} at a time.`,
    );
  }
  return { headers, rows };
}

function readCsv(buffer: Buffer): string[][] {
  const text = buffer.toString('utf8');
  const firstLine = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? '';
  // Excel in some locales saves "CSV" with semicolons.
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  try {
    return parse(text, {
      bom: true,
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
    });
  } catch (err) {
    throw badRequest('VALIDATION_ERROR', `Could not read the CSV file: ${(err as Error).message}`);
  }
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Could not read the Excel file. Save it as .xlsx and try again.');
  }
  // The "Products" sheet, else the first sheet whose header row has a "sku" column.
  const sheet =
    wb.getWorksheet(PRODUCTS_SHEET) ??
    wb.worksheets.find((ws) =>
      (ws.getRow(1).values as unknown[]).some(
        (v) => typeof v === 'string' && normalizeImportHeader(v) === 'sku',
      ),
    );
  if (!sheet) throw badRequest('VALIDATION_ERROR', `No "${PRODUCTS_SHEET}" sheet with a "sku" column found`);

  const width = sheet.getRow(1).cellCount;
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)));
    matrix.push(cells);
  });
  return matrix;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v); // avoid locale/number formats ("1,299.00")
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'result' in v) return formulaResult(v.result);
  return cell.text.trim();
}

// ------------------------------------------------------------------ writing

/** UTF-8 CSV with BOM (so Excel shows ₹ and Tamil text correctly), formula-safe. */
export function writeCsv(headers: readonly string[], rows: readonly Record<string, string>[]): Buffer {
  const body = stringify(
    rows.map((r) => headers.map((h) => safeSpreadsheetCell(r[h] ?? ''))),
    { header: true, columns: [...headers], record_delimiter: 'windows' },
  );
  return Buffer.from(BOM + body, 'utf8');
}

const ALLOWED_BY_COLUMN = new Map<string, readonly string[]>(
  PRODUCT_IMPORT_COLUMNS.filter((c) => 'allowed' in c).map((c) => [
    c.key,
    (c as { allowed: readonly string[] }).allowed,
  ]),
);

/**
 * Products workbook: used for the import template (examples + instructions) and for
 * exports (real data). Header row frozen, dropdowns for fixed-choice columns.
 */
export async function buildProductsWorkbook(opts: {
  rows: readonly Record<string, string>[];
  extraColumns?: readonly string[];
  categories: readonly string[];
  withInstructions: boolean;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sakthimaan Crackers Admin';
  const headers = [...PRODUCT_IMPORT_HEADERS, ...(opts.extraColumns ?? [])];

  const ws = wb.addWorksheet(PRODUCTS_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, Math.min(40, h.length + 6)) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };
  for (const key of PRODUCT_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key)) {
    ws.getCell(1, headers.indexOf(key) + 1).font = { bold: true, color: { argb: 'FFB91C1C' } };
  }
  for (const r of opts.rows) ws.addRow(headers.map((h) => safeSpreadsheetCell(r[h] ?? '')));

  const lastRow = Math.max(500, opts.rows.length + 200);
  const catSheet = wb.addWorksheet('Categories');
  catSheet.columns = [{ header: 'Existing categories', key: 'name', width: 32 }];
  catSheet.getRow(1).font = { bold: true };
  opts.categories.forEach((c) => catSheet.addRow([c]));

  headers.forEach((h, i) => {
    const allowed = ALLOWED_BY_COLUMN.get(h);
    const isCategory = h === 'category' && opts.categories.length > 0;
    if (!allowed && !isCategory) return;
    const col = ws.getColumn(i + 1).letter;
    for (let row = 2; row <= lastRow; row++) {
      ws.getCell(`${col}${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: isCategory
          ? [`Categories!$A$2:$A$${opts.categories.length + 1}`]
          : [`"${(allowed ?? []).join(',')}"`],
        // Category: warn but allow new names (the import can create missing categories).
        showErrorMessage: true,
        errorStyle: isCategory ? 'warning' : 'stop',
        error: isCategory
          ? 'Not an existing category. It will need to be created.'
          : `Choose one of: ${(allowed ?? []).join(', ')}`,
      };
    }
  });

  if (opts.withInstructions) {
    const help = wb.addWorksheet('Instructions');
    help.columns = [
      { header: 'Column', key: 'col', width: 22 },
      { header: 'Required?', key: 'req', width: 11 },
      { header: 'What to enter', key: 'help', width: 80 },
      { header: 'Allowed values', key: 'allowed', width: 32 },
    ];
    help.getRow(1).font = { bold: true };
    for (const c of PRODUCT_IMPORT_COLUMNS) {
      help.addRow({
        col: c.key,
        req: c.required ? 'Required' : 'Optional',
        help: c.help,
        allowed: 'allowed' in c ? c.allowed.join(', ') : '',
      });
    }
    help.addRow({});
    help.addRow({
      col: 'Notes',
      help: 'One product per row. Keep the header row exactly as it is. Delete the example rows before uploading.',
    });
    help.addRow({ help: 'Gift boxes (combos) are created in the admin panel, not in this sheet.' });
    help.addRow({
      help: 'Upload first as a "check" (dry run): the admin panel lists any problems by row number before anything is saved.',
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The import template as CSV (examples only). */
export function buildTemplateCsv(): Buffer {
  return writeCsv(PRODUCT_IMPORT_HEADERS, PRODUCT_IMPORT_EXAMPLES);
}

export const DEFAULT_TEMPLATE_CATEGORIES = [
  'Sparklers',
  'Flower Pots',
  'Ground Chakkars',
  'Rockets',
  'Bombs',
  'Fancy / Aerial',
  'Kids Special',
  'Gift Boxes',
] as const;

function formulaResult(result: unknown): string {
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean')
    return String(result);
  if (result instanceof Date) return result.toISOString().slice(0, 10);
  return ''; // errors (#N/A, #DIV/0!) and empty results
}
