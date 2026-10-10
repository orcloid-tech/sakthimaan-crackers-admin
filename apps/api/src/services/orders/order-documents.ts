import type { Content, TableCell } from 'pdfmake';
import { INDIAN_STATES, buildUpiUri } from '@sakthimaan/shared';
import {
  CreditNoteModel,
  InvoiceModel,
  OrderModel,
  type CreditNote,
  type Invoice,
} from '../../models/index.js';
import { notFound } from '../../utils/app-error.js';
import { PDF_COLORS, pdfDate, pdfMoney, renderPdf, thinTableLayout, type DocDefinition } from '../pdf.js';
import type { SettingsCache } from '../settings-cache.js';

type TaxDoc = (Invoice | CreditNote) & { createdAt?: Date };

const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
const stateLabel = (code: string) => {
  const s = INDIAN_STATES.find((x) => x.code === code);
  return s ? `${s.name} (${s.gstCode})` : code;
};

function addressLines(
  a:
    | {
        line1?: string | null;
        line2?: string | null;
        landmark?: string | null;
        city?: string | null;
        stateCode?: string | null;
        pincode?: string | null;
      }
    | null
    | undefined,
): string {
  if (!a) return '';
  return [
    a.line1,
    a.line2,
    a.landmark,
    [a.city, a.pincode].filter(Boolean).join(' - '),
    a.stateCode ? stateName(a.stateCode) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * GST tax invoice / credit note and packing slip PDFs. Invoices and credit notes are
 * rendered only from their own frozen snapshot, so a reprint years later is identical.
 */
export class OrderDocuments {
  constructor(private readonly settings: SettingsCache) {}

  async invoicePdf(orderId: string): Promise<{ buffer: Buffer; filename: string }> {
    const order = await OrderModel.findById(orderId).select('invoice').lean();
    if (!order?.invoice?.id) throw notFound('Invoice');
    const invoice = await InvoiceModel.findById(order.invoice.id).lean();
    if (!invoice) throw notFound('Invoice');
    const settings = await this.settings.get();
    const upi =
      settings?.invoice?.showUpiQr !== false && settings?.payment?.upiId && invoice.status === 'issued'
        ? buildUpiUri({
            vpa: settings.payment.upiId,
            payeeName: settings.payment.upiPayeeName ?? invoice.seller.name,
            amount: invoice.totals.grandTotal,
            note: invoice.number,
          })
        : null;
    const bank = settings?.payment?.bank;
    const extra: Content[] = [];
    if (bank?.accountNumber) {
      extra.push({
        text: `Bank: ${[bank.accountName, bank.bankName, `A/c ${bank.accountNumber}`, bank.ifsc ? `IFSC ${bank.ifsc}` : null, bank.branch].filter(Boolean).join(' · ')}`,
        fontSize: 8,
      });
    }
    if (upi) {
      extra.push({
        columns: [
          { qr: upi, fit: 70, width: 'auto' },
          {
            text: [{ text: 'Scan to pay by UPI\n', bold: true }, `${settings?.payment?.upiId ?? ''}`],
            fontSize: 8,
            margin: [8, 20, 0, 0],
          },
        ],
        margin: [0, 6, 0, 0],
      });
    }
    const buffer = await renderPdf(
      taxDocument(invoice, {
        title: invoice.status === 'cancelled' ? 'TAX INVOICE (CANCELLED)' : 'TAX INVOICE',
        numberLabel: 'Invoice No',
        reference:
          invoice.status === 'cancelled' && invoice.cancelledBy?.number
            ? `Cancelled by credit note ${invoice.cancelledBy.number}`
            : null,
        terms: invoice.terms ?? null,
        footerNote: invoice.footerNote ?? null,
        extra,
      }),
    );
    return { buffer, filename: `Invoice-${invoice.number.replace(/\//g, '-')}.pdf` };
  }

  async creditNotePdf(creditNoteId: string): Promise<{ buffer: Buffer; filename: string }> {
    const cn = await CreditNoteModel.findById(creditNoteId).lean();
    if (!cn) throw notFound('Credit note');
    const buffer = await renderPdf(
      taxDocument(cn, {
        title: 'CREDIT NOTE',
        numberLabel: 'Credit Note No',
        reference: `Against invoice ${cn.invoiceNumber} dated ${pdfDate(cn.invoiceDate)}. Reason: ${cn.reason || cn.reasonCode.replace('_', ' ')}`,
        terms: null,
        footerNote: null,
        extra: [],
      }),
    );
    return { buffer, filename: `CreditNote-${cn.number.replace(/\//g, '-')}.pdf` };
  }

  async packingSlipPdf(orderId: string): Promise<{ buffer: Buffer; filename: string }> {
    const o = await OrderModel.findById(orderId).lean();
    if (!o) throw notFound('Order');
    const settings = await this.settings.get();
    const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
    const body: TableCell[][] = [
      ['#', 'SKU', 'Item', 'Pack', 'Qty', 'Packed'].map((t) => ({
        text: t,
        bold: true,
        fontSize: 8,
        color: 'white',
        fillColor: PDF_COLORS.brand,
      })),
      ...o.items.map((i, idx) => [
        { text: String(idx + 1), alignment: 'right' as const },
        { text: i.sku, fontSize: 8 },
        {
          stack: [
            { text: i.name, bold: true },
            ...(i.comboContents.length
              ? [
                  {
                    text: i.comboContents.map((c) => `${c.name} × ${c.qty}`).join(', '),
                    fontSize: 7,
                    color: PDF_COLORS.muted,
                  },
                ]
              : []),
          ],
        },
        { text: `${i.contentsCount ?? 1} pcs/${i.unit}`, fontSize: 8 },
        { text: String(i.qty), alignment: 'right' as const, bold: true, fontSize: 11 },
        { text: '' }, // ticked by hand
      ]),
      [
        { text: 'Total units', colSpan: 4, alignment: 'right', bold: true },
        {},
        {},
        {},
        { text: String(totalQty), alignment: 'right', bold: true },
        {},
      ],
    ];
    const doc: DocDefinition = {
      pageSize: 'A4',
      pageMargins: [32, 36, 32, 40],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      content: [
        {
          columns: [
            {
              text: [
                { text: 'PACKING SLIP\n', fontSize: 16, bold: true, color: PDF_COLORS.brand },
                { text: settings?.company?.name ?? '', fontSize: 9 },
              ],
            },
            {
              width: 'auto',
              alignment: 'right',
              text: [{ text: `${o.orderNo}\n`, bold: true, fontSize: 12 }, `Date: ${pdfDate(o.createdAt)}`],
            },
          ],
        },
        {
          margin: [0, 12, 0, 12],
          columns: [
            {
              stack: [
                { text: 'Ship to', color: PDF_COLORS.muted, fontSize: 8 },
                { text: o.customerSnapshot.name, bold: true, fontSize: 11 },
                {
                  text: `Phone: ${o.customerSnapshot.phone}${o.customerSnapshot.altPhone ? ` / ${o.customerSnapshot.altPhone}` : ''}`,
                },
                { text: addressLines(o.shippingAddress) },
              ],
            },
            {
              width: 200,
              stack: [
                { text: 'Dispatch', color: PDF_COLORS.muted, fontSize: 8 },
                { text: `Transport: ${o.dispatch?.transportName ?? '________________'}` },
                { text: `LR No: ${o.dispatch?.lrNumber ?? '________________'}` },
                { text: `Boxes: ${o.dispatch?.boxes ?? '____'}` },
                { text: `Destination: ${o.dispatch?.destination ?? o.shippingAddress.city}` },
              ],
            },
          ],
        },
        {
          table: { headerRows: 1, widths: [18, 70, '*', 55, 35, 45], body, dontBreakRows: true },
          layout: thinTableLayout,
        },
        ...(o.customerNotes
          ? [
              {
                text: `Customer notes: ${o.customerNotes}`,
                margin: [0, 8, 0, 0] as [number, number, number, number],
              },
            ]
          : []),
        {
          margin: [0, 24, 0, 0],
          columns: [
            { text: 'Packed by: ____________________' },
            { text: 'Checked by: ____________________' },
            { text: 'Date: __________', alignment: 'right' },
          ],
        },
        {
          text: 'FIREWORKS: handle with care. Keep away from fire and heat. Do not stack heavy goods on top.',
          fontSize: 8,
          bold: true,
          color: PDF_COLORS.red,
          margin: [0, 16, 0, 0],
        },
      ],
      footer: (page, pages) => ({
        text: `${o.orderNo} · Page ${page} of ${pages}`,
        alignment: 'right',
        fontSize: 7,
        color: PDF_COLORS.muted,
        margin: [32, 12, 32, 0],
      }),
    };
    return { buffer: await renderPdf(doc), filename: `PackingSlip-${o.orderNo.replace(/\//g, '-')}.pdf` };
  }
}

function taxDocument(
  d: TaxDoc,
  opts: {
    title: string;
    numberLabel: string;
    reference: string | null;
    terms: string | null;
    footerNote: string | null;
    extra: Content[];
  },
): DocDefinition {
  const inter = d.isInterState;
  const t = d.totals;
  const head = ['#', 'Item', 'HSN', 'Qty', 'MRP', 'Disc %', 'Rate', 'Taxable', 'GST %', 'Amount'];
  const items: TableCell[][] = [
    head.map((h) => ({
      text: h,
      bold: true,
      fontSize: 7.5,
      color: 'white',
      fillColor: PDF_COLORS.brand,
      alignment: h === 'Item' ? ('left' as const) : ('right' as const),
    })),
    ...d.items.map((i, idx) => [
      { text: String(idx + 1), alignment: 'right' as const },
      { text: [{ text: i.name }, { text: `\n${i.sku}`, fontSize: 7, color: PDF_COLORS.muted }] },
      { text: i.hsn, alignment: 'right' as const },
      { text: `${i.qty} ${i.unit}`, alignment: 'right' as const },
      { text: pdfMoney(i.mrp), alignment: 'right' as const },
      { text: String(i.discountPct), alignment: 'right' as const },
      { text: pdfMoney(i.netPrice), alignment: 'right' as const },
      { text: pdfMoney(i.taxableValue), alignment: 'right' as const },
      { text: String(i.taxRate), alignment: 'right' as const },
      { text: pdfMoney(i.lineTotal), alignment: 'right' as const },
    ]),
  ];

  const row = (labelText: string, value: string, bold = false): TableCell[] => [
    { text: labelText, alignment: 'right', bold },
    { text: value, alignment: 'right', bold },
  ];
  const totals: TableCell[][] = [
    row('MRP total', pdfMoney(t.mrpTotal)),
    row('Less discount', `− ${pdfMoney(t.productDiscount)}`),
    ...(t.couponDiscount ? [row('Coupon', `− ${pdfMoney(t.couponDiscount)}`)] : []),
    ...(t.deliveryCharge ? [row('Delivery', pdfMoney(t.deliveryCharge))] : []),
    ...(t.packingCharge ? [row('Packing', pdfMoney(t.packingCharge))] : []),
    row('Taxable value', pdfMoney(t.taxableValue)),
    ...(inter
      ? [row('IGST', pdfMoney(t.igst))]
      : [row('CGST', pdfMoney(t.cgst)), row('SGST', pdfMoney(t.sgst))]),
    row('Round off', `${t.roundOff >= 0 ? '+' : '−'} ${pdfMoney(Math.abs(t.roundOff))}`),
    row('Grand total (₹)', pdfMoney(t.grandTotal), true),
  ];

  const hsnHead = inter ? ['HSN', 'Rate %', 'Taxable', 'IGST'] : ['HSN', 'Rate %', 'Taxable', 'CGST', 'SGST'];
  const hsn: TableCell[][] = [
    hsnHead.map((h) => ({
      text: h,
      bold: true,
      fontSize: 7.5,
      alignment: 'right' as const,
      fillColor: PDF_COLORS.band,
    })),
    ...d.hsnSummary.map((h) =>
      (inter
        ? [h.hsn, String(h.taxRate), pdfMoney(h.taxableValue), pdfMoney(h.igst)]
        : [h.hsn, String(h.taxRate), pdfMoney(h.taxableValue), pdfMoney(h.cgst), pdfMoney(h.sgst)]
      ).map((v) => ({ text: v, alignment: 'right' as const, fontSize: 7.5 })),
    ),
  ];

  const s = d.seller;
  return {
    pageSize: 'A4',
    pageMargins: [28, 32, 28, 40],
    info: { title: `${opts.title} ${d.number}`, author: s.name },
    defaultStyle: { font: 'Roboto', fontSize: 8.5 },
    content: [
      {
        columns: [
          {
            stack: [
              { text: s.name, fontSize: 15, bold: true, color: PDF_COLORS.brand },
              ...(s.legalName && s.legalName !== s.name ? [{ text: s.legalName, fontSize: 8 }] : []),
              { text: addressLines(s.address), fontSize: 8 },
              {
                text: [s.phone ? `Phone: ${s.phone}` : '', s.email ? `  ·  ${s.email}` : ''].join(''),
                fontSize: 8,
              },
              {
                text: `GSTIN: ${s.gstin ?? '—'}   ·   State: ${stateLabel(s.stateCode)}`,
                fontSize: 8,
                bold: true,
              },
              ...(s.licenseNumber
                ? [{ text: `Explosives Licence No: ${s.licenseNumber}`, fontSize: 8, bold: true }]
                : []),
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: opts.title, fontSize: 13, bold: true },
              { text: `${opts.numberLabel}: ${d.number}`, bold: true },
              { text: `Date: ${pdfDate(d.issuedAt)}` },
              { text: `Order: ${d.orderNo}` },
            ],
          },
        ],
      },
      {
        canvas: [{ type: 'line', x1: 0, y1: 6, x2: 539, y2: 6, lineWidth: 0.6, lineColor: PDF_COLORS.line }],
      },
      {
        margin: [0, 8, 0, 8],
        columns: [
          {
            stack: [
              { text: 'Bill to / Ship to', color: PDF_COLORS.muted, fontSize: 7.5 },
              { text: d.buyer.name, bold: true, fontSize: 10 },
              { text: addressLines(d.buyer.address) },
              { text: `Phone: ${d.buyer.phone}` },
              ...(d.buyer.gstin ? [{ text: `GSTIN: ${d.buyer.gstin}`, bold: true }] : []),
            ],
          },
          {
            width: 200,
            stack: [
              { text: 'Place of supply', color: PDF_COLORS.muted, fontSize: 7.5 },
              { text: stateLabel(d.placeOfSupply), bold: true },
              {
                text: inter ? 'Inter-state supply (IGST)' : 'Intra-state supply (CGST + SGST)',
                fontSize: 7.5,
              },
              { text: 'Prices are inclusive of GST', fontSize: 7.5, color: PDF_COLORS.muted },
            ],
          },
        ],
      },
      ...(opts.reference
        ? [{ text: opts.reference, bold: true, margin: [0, 0, 0, 6] as [number, number, number, number] }]
        : []),
      {
        table: {
          headerRows: 1,
          widths: [14, '*', 32, 38, 40, 28, 40, 46, 26, 48],
          body: items,
          dontBreakRows: true,
        },
        layout: thinTableLayout,
      },
      {
        margin: [0, 8, 0, 0],
        columns: [
          {
            width: '*',
            stack: [
              {
                table: { headerRows: 1, widths: inter ? [50, 40, 70, 60] : [50, 40, 60, 50, 50], body: hsn },
                layout: thinTableLayout,
              },
              { text: t.amountInWords, bold: true, margin: [0, 8, 0, 0] },
              ...opts.extra,
            ],
          },
          { width: 190, table: { widths: ['*', 75], body: totals }, layout: 'noBorders' },
        ],
      },
      ...(opts.terms
        ? [
            {
              text: [{ text: 'Terms: ', bold: true }, opts.terms],
              fontSize: 7.5,
              margin: [0, 10, 0, 0] as [number, number, number, number],
            },
          ]
        : []),
      {
        margin: [0, 24, 0, 0],
        columns: [
          {
            text: opts.footerNote ?? 'This is a computer-generated document.',
            fontSize: 7.5,
            color: PDF_COLORS.muted,
          },
          {
            width: 180,
            alignment: 'center',
            text: [{ text: `For ${s.name}\n\n\n`, bold: true }, 'Authorised Signatory'],
          },
        ],
      },
    ],
    footer: (page, pages) => ({
      text: `${d.number} · Page ${page} of ${pages}`,
      alignment: 'right',
      fontSize: 7,
      color: PDF_COLORS.muted,
      margin: [28, 12, 28, 0],
    }),
  };
}
