import type { Content, TableCell } from 'pdfmake';
import { renderPdf, type DocDefinition } from '../pdf.js';
import type { PriceListQuery } from '@sakthimaan/shared';
import { CategoryModel, ProductModel, SeasonModel } from '../../models/index.js';
import { oid } from '../../utils/query.js';
import type { CompanyAssets } from '../company-assets.js';
import type { SettingsCache } from '../settings-cache.js';

const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);

const COLORS = { band: '#FEF3C7', header: '#B45309', green: '#15803D', muted: '#6B7280', out: '#B91C1C' };

/**
 * Printable price list (the business's main sales document): products grouped by
 * category in display order, MRP / discount / net price, empty Qty and Amount columns
 * for customers who write their order on paper, store licence and GSTIN in the header.
 */
export class PriceListService {
  constructor(
    private readonly settings: SettingsCache,
    private readonly assets?: CompanyAssets,
  ) {}

  async render(q: PriceListQuery): Promise<Buffer> {
    const [settings, categories, season, logo] = await Promise.all([
      this.settings.get(),
      CategoryModel.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      SeasonModel.findOne({ endDate: { $gte: new Date() } })
        .sort({ startDate: 1 })
        .lean(),
      this.assets?.logo() ?? null,
    ]);

    const productFilter: Record<string, unknown> = { isActive: true };
    if (!q.includeOutOfStock) productFilter.stock = { $gt: 0 };
    if (!q.includeCombos) productFilter.type = 'single';
    if (q.categoryId) {
      productFilter.$or = [{ category: oid(q.categoryId) }, { subCategory: oid(q.categoryId) }];
    }
    const products = await ProductModel.find(productFilter).sort({ sortOrder: 1, name: 1 }).lean();
    const comboIds = products.flatMap((p) => p.comboItems.map((c) => c.product));
    const comboNames = new Map(
      (await ProductModel.find({ _id: { $in: comboIds } }, { name: 1 }, { withDeleted: true }).lean()).map(
        (p) => [String(p._id), p.name],
      ),
    );

    // Group: top-level category (display order) → its own products, then each sub-category.
    const roots = categories.filter((c) => !c.parent);
    const body: TableCell[][] = [
      ['#', 'Product', 'Content', 'MRP ₹', 'Disc %', 'Net ₹', 'Qty', 'Amount ₹'].map((t) => ({
        text: t,
        style: 'th',
      })),
    ];
    let serial = 0;
    for (const root of roots) {
      const groups = [
        {
          title: root.name,
          items: products.filter((p) => String(p.category) === String(root._id) && !p.subCategory),
        },
        ...categories
          .filter((c) => c.parent && String(c.parent) === String(root._id))
          .map((sub) => ({
            title: `${root.name} · ${sub.name}`,
            items: products.filter((p) => p.subCategory && String(p.subCategory) === String(sub._id)),
          })),
      ].filter((g) => g.items.length > 0);

      for (const group of groups) {
        body.push([
          { text: group.title.toUpperCase(), colSpan: 8, style: 'band', fillColor: COLORS.band },
          {},
          {},
          {},
          {},
          {},
          {},
          {},
        ]);
        for (const p of group.items) {
          serial += 1;
          const nameStack: Content[] = [
            {
              text: [
                { text: p.name, bold: true },
                ...(p.isGreen ? [{ text: '  GREEN', color: COLORS.green, fontSize: 7, bold: true }] : []),
                ...(p.stock <= 0
                  ? [{ text: '  OUT OF STOCK', color: COLORS.out, fontSize: 7, bold: true }]
                  : []),
              ],
            },
          ];
          if (p.type === 'combo' && p.comboItems.length > 0) {
            nameStack.push({
              text: p.comboItems
                .map((c) => `${comboNames.get(String(c.product)) ?? 'Item'} × ${c.qty}`)
                .join(', '),
              fontSize: 7,
              color: COLORS.muted,
            });
          }
          body.push([
            { text: String(serial), alignment: 'right' },
            { stack: nameStack },
            { text: `${p.contentsCount ?? 1} pcs/${p.unit}`, fontSize: 8 },
            { text: money(p.mrp), alignment: 'right', decoration: 'lineThrough', color: COLORS.muted },
            { text: String(p.discountPct), alignment: 'right' },
            { text: money(p.netPrice), alignment: 'right', bold: true },
            { text: '' },
            { text: '' },
          ]);
        }
      }
    }
    if (serial === 0)
      body.push([{ text: 'No products to list.', colSpan: 8, italics: true }, {}, {}, {}, {}, {}, {}, {}]);

    const company = settings?.company;
    const address = company?.address
      ? [company.address.line1, company.address.line2, company.address.city, company.address.pincode]
          .filter(Boolean)
          .join(', ')
      : '';
    const title = season ? `PRICE LIST · ${season.name}` : `PRICE LIST ${new Date().getFullYear()}`;
    const minOrder = settings?.order?.defaultMinOrderValue;

    const doc: DocDefinition = {
      pageSize: 'A4',
      pageMargins: [28, 36, 28, 40],
      info: { title, author: company?.name ?? 'Sakthimaan Crackers', subject: 'Price list' },
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      styles: {
        company: { fontSize: 16, bold: true, color: COLORS.header },
        title: { fontSize: 12, bold: true, alignment: 'center', margin: [0, 8, 0, 2] },
        note: { fontSize: 8, color: COLORS.muted, alignment: 'center' },
        th: { bold: true, fontSize: 8, color: 'white', fillColor: COLORS.header },
        band: { bold: true, fontSize: 8, color: COLORS.header },
      },
      content: [
        {
          columns: [
            {
              width: '*',
              stack: [
                ...(logo
                  ? [
                      {
                        image: logo,
                        fit: [150, 50] as [number, number],
                        margin: [0, 0, 0, 4] as [number, number, number, number],
                      },
                    ]
                  : []),
                { text: company?.name || 'Sakthimaan Crackers', style: 'company' },
                ...(address ? [{ text: address, fontSize: 8 }] : []),
                ...(company?.phones?.length
                  ? [{ text: `Phone: ${company.phones.join(' / ')}`, fontSize: 8 }]
                  : []),
                ...(company?.email ? [{ text: company.email, fontSize: 8 }] : []),
              ],
            },
            {
              width: 'auto',
              alignment: 'right',
              stack: [
                ...(company?.licenseNumber
                  ? [{ text: `Licence No: ${company.licenseNumber}`, fontSize: 8, bold: true }]
                  : []),
                ...(company?.gstin ? [{ text: `GSTIN: ${company.gstin}`, fontSize: 8 }] : []),
              ],
            },
          ],
        },
        { text: title, style: 'title' },
        {
          text:
            'All prices in ₹ and inclusive of GST. Net price = MRP less discount.' +
            (minOrder ? ` Minimum order ₹${money(minOrder)}.` : '') +
            ' Write quantities in the Qty column and send us a photo or call us.',
          style: 'note',
          margin: [0, 0, 0, 8],
        },
        {
          table: { headerRows: 1, widths: [18, '*', 52, 46, 30, 46, 28, 48], body, dontBreakRows: true },
          layout: {
            hLineWidth: () => 0.4,
            vLineWidth: () => 0.4,
            hLineColor: () => '#D1D5DB',
            vLineColor: () => '#D1D5DB',
            paddingTop: () => 2,
            paddingBottom: () => 2,
          },
        },
        {
          text: 'GREEN = green cracker (reduced emission). Please follow the safety instructions on each pack. Not for sale to children.',
          style: 'note',
          margin: [0, 8, 0, 0],
        },
      ],
      footer: (currentPage, pageCount) => ({
        columns: [
          {
            text: `Generated ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
            fontSize: 7,
            color: COLORS.muted,
          },
          {
            text: `Page ${currentPage} of ${pageCount}`,
            alignment: 'right',
            fontSize: 7,
            color: COLORS.muted,
          },
        ],
        margin: [28, 12, 28, 0],
      }),
    };

    return renderPdf(doc);
  }
}
