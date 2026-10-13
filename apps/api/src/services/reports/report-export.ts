import ExcelJS from 'exceljs';
import {
  INDIAN_STATES,
  safeSpreadsheetCell,
  type DispatchReport,
  type GstReport,
  type PaymentsReport,
  type ProductSalesReport,
  type ReportKind,
  type ReportPeriod,
  type SalesReport,
  type StateSalesReport,
  type StockReport,
} from '@sakthimaan/shared';
import { istDayOf } from './period.js';

type Kind = 'text' | 'money' | 'int' | 'pct' | 'date';
interface Col {
  header: string;
  key: string;
  width?: number;
  kind?: Kind;
}
interface Sheet {
  name: string;
  columns: Col[];
  rows: readonly object[];
  totals?: object;
  /** Extra lines under the title (e.g. "Seller GSTIN: …"). */
  notes?: string[];
}

const TITLES: Record<ReportKind, string> = {
  sales: 'Sales report',
  products: 'Product and category sales',
  states: 'State-wise sales',
  gst: 'GST report',
  payments: 'Payment collection',
  dispatch: 'Dispatch report',
  stock: 'Stock report',
};

const fmtDay = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1));
};
const rupees = (paise: unknown) => (typeof paise === 'number' ? paise / 100 : paise);
/** GSTR-1 style place of supply, e.g. "33-Tamil Nadu". */
const pos = (code: string) => {
  const s = INDIAN_STATES.find((x) => x.code === code);
  return s ? `${s.gstCode}-${s.name}` : code;
};

function writeSheet(wb: ExcelJS.Workbook, title: string, period: ReportPeriod, sheet: Sheet): void {
  const ws = wb.addWorksheet(sheet.name.slice(0, 31));
  const head = [
    period.storeName ?? '',
    `${title} · ${period.from} to ${period.to} (FY ${period.financialYear})`,
    ...(sheet.notes ?? []),
    `Generated ${new Date(period.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
  ].filter(Boolean);
  head.forEach((line, i) => {
    const r = ws.addRow([line]);
    if (i === 0) r.font = { bold: true, size: 13 };
  });
  ws.addRow([]);
  const headerRow = ws.addRow(sheet.columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  const value = (c: Col, v: unknown) => {
    if (v === null || v === undefined) return '';
    if (c.kind === 'money') return rupees(v);
    // Full timestamps are shown as their IST calendar day.
    if (c.kind === 'date' && typeof v === 'string' && v)
      return fmtDay(v.length > 10 ? istDayOf(new Date(v)) : v);
    if (typeof v === 'string') return safeSpreadsheetCell(v);
    return v;
  };
  const get = (o: object | undefined, k: string) => (o as Record<string, unknown> | undefined)?.[k];
  for (const row of sheet.rows) ws.addRow(sheet.columns.map((c) => value(c, get(row, c.key))));
  if (sheet.rows.length === 0) ws.addRow(['No records in this period.']).font = { italic: true };
  if (sheet.totals) {
    const t = ws.addRow(
      sheet.columns.map((c, i) =>
        i === 0 && get(sheet.totals, c.key) === undefined ? 'Total' : value(c, get(sheet.totals, c.key)),
      ),
    );
    t.font = { bold: true };
    t.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
  }
  sheet.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(10, Math.min(40, c.header.length + 4));
    if (c.kind === 'money') col.numFmt = '#,##0.00';
    if (c.kind === 'int') col.numFmt = '#,##0';
    if (c.kind === 'pct') col.numFmt = '0.##';
    if (c.kind === 'date') col.numFmt = 'dd-mmm-yyyy';
  });
}

const m = (header: string, key: string, width = 14): Col => ({ header, key, width, kind: 'money' });
const n = (header: string, key: string, width = 10): Col => ({ header, key, width, kind: 'int' });
const t = (header: string, key: string, width?: number): Col => ({ header, key, width, kind: 'text' });
const d = (header: string, key: string): Col => ({ header, key, width: 13, kind: 'date' });

// ------------------------------------------------------------------ sheets per report

function salesSheets(r: SalesReport): Sheet[] {
  return [
    {
      name: 'Daily sales',
      columns: [
        d('Date', 'date'),
        n('Orders', 'orders'),
        m('Sales (₹)', 'sales'),
        m('Average order (₹)', 'avgOrderValue', 18),
      ],
      rows: r.rows,
      totals: { orders: r.totals.orders, sales: r.totals.sales, avgOrderValue: r.totals.avgOrderValue },
      notes: ['Confirmed orders (not cancelled) by confirmation date. Amounts include GST.'],
    },
  ];
}

function productSheets(r: ProductSalesReport): Sheet[] {
  return [
    {
      name: 'Products',
      columns: [
        t('SKU', 'sku', 16),
        t('Product', 'name', 36),
        t('Category', 'category', 20),
        n('Qty', 'qty'),
        n('Orders', 'orders'),
        m('Amount (₹)', 'amount'),
      ],
      rows: r.products,
      totals: { qty: r.totals.qty, amount: r.totals.amount },
    },
    {
      name: 'Categories',
      columns: [t('Category', 'name', 28), n('Qty', 'qty'), n('Orders', 'orders'), m('Amount (₹)', 'amount')],
      rows: r.categories,
      totals: { qty: r.totals.qty, amount: r.totals.amount },
    },
  ];
}

function stateSheets(r: StateSalesReport): Sheet[] {
  return [
    {
      name: 'States',
      columns: [
        t('State', 'stateName', 26),
        t('Code', 'stateCode', 8),
        n('Orders', 'orders'),
        m('Sales (₹)', 'sales'),
        m('Average order (₹)', 'avgOrderValue', 18),
      ],
      rows: r.rows,
      totals: { orders: r.totals.orders, sales: r.totals.sales },
    },
  ];
}

/**
 * GST workbook laid out like the GSTR-1 tables (B2B, B2CL, B2CS, CDNR, CDNUR, HSN, Docs)
 * plus a plain register of every invoice and credit note, so the accountant can file
 * from it or reconcile against the books.
 */
function gstSheets(r: GstReport): Sheet[] {
  const gstinNote = r.sellerGstin ? `Seller GSTIN: ${r.sellerGstin}` : 'Seller GSTIN: not set in Settings';
  const inv = new Map(r.invoices.map((x) => [x.number, x]));
  const cns = new Map(r.creditNotes.map((x) => [x.number, x]));
  const invLines = r.rateLines.filter((l) => l.kind === 'invoice');
  const cnLines = r.rateLines.filter((l) => l.kind === 'credit_note');
  const taxCols = [
    m('Taxable value', 'taxableValue'),
    m('IGST', 'igst', 12),
    m('CGST', 'cgst', 12),
    m('SGST', 'sgst', 12),
    m('Cess', 'cess', 8),
  ];

  const b2b = invLines
    .filter((l) => inv.get(l.number)?.buyerGstin)
    .map((l) => {
      const i = inv.get(l.number);
      return {
        gstin: i?.buyerGstin,
        name: i?.buyerName,
        date: i?.date,
        value: i?.total,
        pos: pos(i?.placeOfSupply ?? ''),
        rc: 'N',
        type: 'Regular B2B',
        rate: l.taxRate,
        ...l,
        cess: 0,
      };
    });
  const unregistered = invLines.filter((l) => !inv.get(l.number)?.buyerGstin);
  const isLarge = (num: string) => {
    const i = inv.get(num);
    return !!i && r.b2clThreshold !== null && i.isInterState && i.total > r.b2clThreshold;
  };
  const b2cl = unregistered
    .filter((l) => isLarge(l.number))
    .map((l) => {
      const i = inv.get(l.number);
      return {
        date: i?.date,
        value: i?.total,
        pos: pos(i?.placeOfSupply ?? ''),
        rate: l.taxRate,
        ...l,
        cess: 0,
      };
    });
  const b2csMap = new Map<
    string,
    Record<string, unknown> & { taxableValue: number; igst: number; cgst: number; sgst: number }
  >();
  for (const l of unregistered.filter((x) => !isLarge(x.number))) {
    const i = inv.get(l.number);
    const key = `${i?.placeOfSupply}|${l.taxRate}`;
    const e = b2csMap.get(key) ?? {
      type: 'OE',
      pos: pos(i?.placeOfSupply ?? ''),
      rate: l.taxRate,
      taxableValue: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    };
    e.taxableValue += l.taxableValue;
    e.igst += l.igst;
    e.cgst += l.cgst;
    e.sgst += l.sgst;
    b2csMap.set(key, e);
  }
  const cdn = (registered: boolean) =>
    cnLines
      .filter((l) => !!cns.get(l.number)?.buyerGstin === registered)
      .map((l) => {
        const c = cns.get(l.number);
        return {
          gstin: c?.buyerGstin,
          name: c?.buyerName,
          date: c?.date,
          noteType: 'C',
          invoiceNumber: c?.invoiceNumber,
          invoiceDate: c?.invoiceDate,
          pos: pos(c?.placeOfSupply ?? ''),
          value: c?.total,
          rate: l.taxRate,
          ...l,
          cess: 0,
        };
      });
  const docsRow = (label: string, rows: { number: string }[]) =>
    rows.length
      ? { nature: label, from: rows[0]?.number, to: rows.at(-1)?.number, total: rows.length, cancelled: 0 }
      : null;

  return [
    {
      name: 'Summary',
      notes: [gstinNote, 'Amounts in ₹. Credit notes are netted off in the HSN and rate summaries.'],
      columns: [
        t('', 'label', 28),
        n('Documents', 'count'),
        m('Taxable value', 'taxableValue'),
        m('IGST', 'igst'),
        m('CGST', 'cgst'),
        m('SGST', 'sgst'),
        m('Total tax', 'totalTax'),
        m('Total', 'total'),
      ],
      rows: [
        { label: 'Invoices', ...r.totals.invoices },
        { label: 'Less: credit notes', ...r.totals.creditNotes },
        { label: 'Net', ...r.totals.net, count: undefined },
      ],
    },
    {
      name: 'b2b',
      notes: ['GSTR-1 Table 4A: invoices to registered buyers, one line per GST rate.'],
      columns: [
        t('GSTIN/UIN of Recipient', 'gstin', 18),
        t('Receiver Name', 'name', 24),
        t('Invoice Number', 'number', 16),
        d('Invoice date', 'date'),
        m('Invoice Value', 'value'),
        t('Place Of Supply', 'pos', 20),
        t('Reverse Charge', 'rc', 9),
        t('Invoice Type', 'type', 13),
        { header: 'Rate', key: 'rate', kind: 'pct', width: 7 },
        ...taxCols,
      ],
      rows: b2b,
    },
    {
      name: 'b2cl',
      notes: [
        r.b2clThreshold !== null
          ? `GSTR-1 Table 5: inter-state invoices to unregistered buyers above ₹${(r.b2clThreshold / 100).toLocaleString('en-IN')} (limit from Settings).`
          : 'GSTR-1 Table 5: B2C (large) limit is not set in Settings, so all B2C invoices are in b2cs.',
      ],
      columns: [
        t('Invoice Number', 'number', 16),
        d('Invoice date', 'date'),
        m('Invoice Value', 'value'),
        t('Place Of Supply', 'pos', 20),
        { header: 'Rate', key: 'rate', kind: 'pct', width: 7 },
        ...taxCols,
      ],
      rows: b2cl,
    },
    {
      name: 'b2cs',
      notes: ['GSTR-1 Table 7: other sales to unregistered buyers, by place of supply and rate.'],
      columns: [
        t('Type', 'type', 6),
        t('Place Of Supply', 'pos', 20),
        { header: 'Rate', key: 'rate', kind: 'pct', width: 7 },
        ...taxCols,
      ],
      rows: [...b2csMap.values()],
    },
    {
      name: 'cdnr',
      notes: ['GSTR-1 Table 9B: credit notes to registered buyers.'],
      columns: [
        t('GSTIN/UIN of Recipient', 'gstin', 18),
        t('Receiver Name', 'name', 24),
        t('Note Number', 'number', 16),
        d('Note Date', 'date'),
        t('Note Type', 'noteType', 8),
        t('Original Invoice', 'invoiceNumber', 16),
        d('Original Invoice Date', 'invoiceDate'),
        t('Place Of Supply', 'pos', 20),
        m('Note Value', 'value'),
        { header: 'Rate', key: 'rate', kind: 'pct', width: 7 },
        ...taxCols,
      ],
      rows: cdn(true),
    },
    {
      name: 'cdnur',
      notes: ['GSTR-1 Table 9B: credit notes to unregistered buyers.'],
      columns: [
        t('Note Number', 'number', 16),
        d('Note Date', 'date'),
        t('Note Type', 'noteType', 8),
        t('Original Invoice', 'invoiceNumber', 16),
        d('Original Invoice Date', 'invoiceDate'),
        t('Place Of Supply', 'pos', 20),
        m('Note Value', 'value'),
        { header: 'Rate', key: 'rate', kind: 'pct', width: 7 },
        ...taxCols,
      ],
      rows: cdn(false),
    },
    {
      name: 'hsn',
      notes: ['GSTR-1 Table 12: HSN-wise summary, credit notes netted off.'],
      columns: [
        t('HSN', 'hsn', 10),
        t('UQC', 'uqc', 7),
        n('Total Quantity', 'qty', 14),
        m('Total Value', 'total'),
        { header: 'Rate', key: 'taxRate', kind: 'pct', width: 7 },
        m('Taxable Value', 'taxableValue'),
        m('Integrated Tax', 'igst'),
        m('Central Tax', 'cgst'),
        m('State/UT Tax', 'sgst'),
        m('Cess', 'cess', 8),
      ],
      rows: r.hsn.map((h) => ({ ...h, cess: 0 })),
    },
    {
      name: 'docs',
      notes: ['GSTR-1 Table 13: documents issued.'],
      columns: [
        t('Nature of Document', 'nature', 34),
        t('Sr. No. From', 'from', 16),
        t('Sr. No. To', 'to', 16),
        n('Total Number', 'total', 12),
        n('Cancelled', 'cancelled'),
      ],
      rows: [
        docsRow('Invoices for outward supply', r.invoices),
        docsRow('Credit Note', r.creditNotes),
      ].filter((x): x is NonNullable<typeof x> => x !== null),
    },
    {
      name: 'Invoice register',
      columns: [
        t('Invoice', 'number', 16),
        d('Date', 'date'),
        t('Order', 'orderNo', 17),
        t('Buyer', 'buyerName', 24),
        t('Buyer GSTIN', 'buyerGstin', 17),
        t('Place of supply', 'pos', 20),
        m('Taxable value', 'taxableValue'),
        m('CGST', 'cgst'),
        m('SGST', 'sgst'),
        m('IGST', 'igst'),
        m('Total', 'total'),
      ],
      rows: r.invoices.map((x) => ({ ...x, pos: pos(x.placeOfSupply) })),
      totals: r.totals.invoices,
    },
    {
      name: 'Credit note register',
      columns: [
        t('Credit note', 'number', 16),
        d('Date', 'date'),
        t('Against invoice', 'invoiceNumber', 16),
        t('Order', 'orderNo', 17),
        t('Buyer', 'buyerName', 24),
        t('Reason', 'reason', 24),
        m('Taxable value', 'taxableValue'),
        m('CGST', 'cgst'),
        m('SGST', 'sgst'),
        m('IGST', 'igst'),
        m('Total', 'total'),
      ],
      rows: r.creditNotes,
      totals: r.totals.creditNotes,
    },
  ];
}

function paymentSheets(r: PaymentsReport): Sheet[] {
  return [
    {
      name: 'By method',
      columns: [
        t('Method', 'method', 16),
        n('Payments', 'payments'),
        m('Received (₹)', 'received'),
        n('Refunds', 'refunds'),
        m('Refunded (₹)', 'refunded'),
        m('Net (₹)', 'net'),
      ],
      rows: r.byMethod,
      totals: { received: r.totals.received, refunded: r.totals.refunded, net: r.totals.net },
    },
    {
      name: 'Payments',
      columns: [
        d('Paid on', 'paidAt'),
        t('Order', 'orderNo', 17),
        t('Customer', 'customer', 24),
        t('Kind', 'kind', 9),
        t('Method', 'method', 14),
        t('Reference', 'reference', 20),
        m('Amount (₹)', 'amount'),
        t('Recorded by', 'recordedBy', 18),
      ],
      rows: r.payments,
    },
    {
      name: 'Voided',
      columns: [
        d('Voided on', 'voidedAt'),
        t('Order', 'orderNo', 17),
        t('Method', 'method', 14),
        t('Reference', 'reference', 20),
        m('Amount (₹)', 'amount'),
        t('Reason', 'reason', 30),
        t('Voided by', 'voidedBy', 18),
      ],
      rows: r.voided,
      totals: { amount: r.totals.voided },
    },
    {
      name: 'Outstanding',
      notes: ['As of now: confirmed orders with money still due.'],
      columns: [
        t('Order', 'orderNo', 17),
        t('Customer', 'customer', 24),
        t('Phone', 'phone', 12),
        t('Status', 'status', 16),
        d('Confirmed', 'confirmedAt'),
        m('Total (₹)', 'total'),
        m('Paid (₹)', 'paid'),
        m('Due (₹)', 'due'),
      ],
      rows: r.outstanding,
      totals: { due: r.totals.outstanding },
    },
  ];
}

function dispatchSheets(r: DispatchReport): Sheet[] {
  return [
    {
      name: 'By transport',
      columns: [t('Transport', 'transportName', 28), n('Orders', 'orders'), n('Boxes', 'boxes')],
      rows: r.byPartner,
      totals: { orders: r.totals.orders, boxes: r.totals.boxes },
    },
    {
      name: 'Consignments',
      columns: [
        d('Dispatched', 'dispatchDate'),
        t('Order', 'orderNo', 17),
        t('Customer', 'customer', 24),
        t('City', 'city', 16),
        t('State', 'stateCode', 7),
        t('Transport', 'transportName', 22),
        t('LR number', 'lrNumber', 16),
        n('Boxes', 'boxes', 8),
        { header: 'Weight (kg)', key: 'weightKg', kind: 'pct', width: 11 },
        t('Status', 'status', 12),
      ],
      rows: r.rows,
      totals: { boxes: r.totals.boxes },
    },
  ];
}

function stockSheets(r: StockReport): Sheet[] {
  const moveCols: Col[] = [
    n('Stock in', 'stock_in'),
    n('Stock out', 'stock_out'),
    n('Adjusted', 'adjustment'),
    n('Sold (orders)', 'order_deduct', 13),
    n('Returned (cancelled)', 'order_restock', 18),
  ];
  return [
    {
      name: 'Stock',
      notes: ['Current stock (as of now) valued at the net selling price. Movements are for the period.'],
      columns: [
        t('SKU', 'sku', 16),
        t('Product', 'name', 36),
        t('Category', 'category', 20),
        t('Active', 'active', 7),
        n('Stock', 'stock'),
        m('Net price (₹)', 'netPrice'),
        m('Value (₹)', 'value'),
        t('Low', 'low', 6),
        ...moveCols,
      ],
      rows: r.rows.map((x) => ({
        ...x,
        ...x.movements,
        active: x.isActive ? 'Yes' : 'No',
        low: x.isLow ? 'Yes' : '',
      })),
      totals: { stock: r.totals.units, value: r.totals.value },
    },
  ];
}

export async function reportWorkbook(
  kind: ReportKind,
  data: unknown,
): Promise<{ buffer: Buffer; filename: string }> {
  const sheets =
    kind === 'sales'
      ? salesSheets(data as SalesReport)
      : kind === 'products'
        ? productSheets(data as ProductSalesReport)
        : kind === 'states'
          ? stateSheets(data as StateSalesReport)
          : kind === 'gst'
            ? gstSheets(data as GstReport)
            : kind === 'payments'
              ? paymentSheets(data as PaymentsReport)
              : kind === 'dispatch'
                ? dispatchSheets(data as DispatchReport)
                : stockSheets(data as StockReport);
  const period = (data as { period: ReportPeriod }).period;
  const wb = new ExcelJS.Workbook();
  wb.creator = period.storeName ?? 'Store admin';
  wb.created = new Date(period.generatedAt);
  for (const s of sheets) writeSheet(wb, TITLES[kind], period, s);
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${kind}-report_${period.from}_to_${period.to}.xlsx`,
  };
}
