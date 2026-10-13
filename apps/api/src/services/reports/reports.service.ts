import type { PipelineStage, Types } from 'mongoose';
import {
  INDIAN_STATES,
  STOCK_COMMITTED_STATUSES,
  STOCK_MOVEMENT_TYPES,
  UQC_BY_UNIT,
  type DispatchReport,
  type GstDocumentRow,
  type GstReport,
  type GstTaxTotals,
  type IndianStateCode,
  type OrderStatus,
  type PaymentMethod,
  type PaymentsReport,
  type ProductSalesReport,
  type ReportPeriod,
  type SalesReport,
  type StateSalesReport,
  type StockMovementType,
  type StockReport,
} from '@sakthimaan/shared';
import {
  CategoryModel,
  CreditNoteModel,
  CustomerModel,
  InvoiceModel,
  OrderModel,
  PaymentModel,
  ProductModel,
  StockMovementModel,
} from '../../models/index.js';
import type { SettingsCache } from '../settings-cache.js';
import { daysBetween, istDayOf, reportPeriod } from './period.js';

type Period = ReturnType<typeof reportPeriod>;
const publicPeriod = (p: Period): ReportPeriod => ({
  from: p.from,
  to: p.to,
  financialYear: p.financialYear,
  generatedAt: p.generatedAt,
  storeName: p.storeName,
});
const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
const avg = (sum: number, n: number) => (n > 0 ? Math.round(sum / n) : 0);
const COMMITTED = [...STOCK_COMMITTED_STATUSES];

const zeroTax = (): GstTaxTotals => ({ taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, total: 0 });
function addTax(into: GstTaxTotals, t: Partial<GstTaxTotals>, sign = 1): void {
  into.taxableValue += sign * (t.taxableValue ?? 0);
  into.cgst += sign * (t.cgst ?? 0);
  into.sgst += sign * (t.sgst ?? 0);
  into.igst += sign * (t.igst ?? 0);
  into.totalTax += sign * (t.totalTax ?? (t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0));
  into.total += sign * (t.total ?? 0);
}

/**
 * Business reports, all computed from the stored records (orders, invoices, credit
 * notes, payments, stock ledger) for a period of whole IST days. Conventions match the
 * dashboard: "sales" = confirmed, not cancelled orders by confirmation date; money as
 * recorded payments by payment date; GST strictly from the issued documents.
 */
export class ReportsService {
  constructor(private readonly settings: SettingsCache) {}

  private async period(q: { from?: string; to?: string }): Promise<Period> {
    return reportPeriod(q, (await this.settings.get())?.company?.name || null);
  }

  private salesMatch(p: Period): PipelineStage.Match {
    return {
      $match: { isDeleted: false, status: { $in: COMMITTED }, confirmedAt: { $gte: p.start, $lte: p.end } },
    };
  }

  // ---------------------------------------------------------------- sales

  async sales(q: { from?: string; to?: string }): Promise<SalesReport> {
    const p = await this.period(q);
    const daily = await OrderModel.aggregate<{ _id: string; orders: number; sales: number }>([
      this.salesMatch(p),
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$confirmedAt', timezone: 'Asia/Kolkata' } },
          orders: { $sum: 1 },
          sales: { $sum: '$pricing.grandTotal' },
        },
      },
    ]);
    const byDay = new Map(daily.map((d) => [d._id, d]));
    const rows = daysBetween(p.from, p.to).map((date) => {
      const d = byDay.get(date);
      return {
        date,
        orders: d?.orders ?? 0,
        sales: d?.sales ?? 0,
        avgOrderValue: avg(d?.sales ?? 0, d?.orders ?? 0),
      };
    });
    const orders = rows.reduce((s, r) => s + r.orders, 0);
    const sales = rows.reduce((s, r) => s + r.sales, 0);
    return {
      period: publicPeriod(p),
      rows,
      totals: { orders, sales, avgOrderValue: avg(sales, orders), days: rows.length },
    };
  }

  // ---------------------------------------------------------------- products & categories

  async products(q: { from?: string; to?: string }): Promise<ProductSalesReport> {
    const p = await this.period(q);
    const lines = await OrderModel.aggregate<{
      _id: Types.ObjectId;
      sku: string;
      name: string;
      category: string;
      qty: number;
      amount: number;
      orders: Types.ObjectId[];
    }>([
      this.salesMatch(p),
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          sku: { $last: '$items.sku' },
          name: { $last: '$items.name' },
          category: { $last: '$items.categoryName' },
          qty: { $sum: '$items.qty' },
          amount: { $sum: '$items.lineTotal' },
          orders: { $addToSet: '$_id' },
        },
      },
      { $sort: { amount: -1 } },
    ]);
    const products = lines.map((l) => ({
      productId: String(l._id),
      sku: l.sku,
      name: l.name,
      category: l.category,
      qty: l.qty,
      amount: l.amount,
      orders: l.orders.length,
    }));
    const cats = new Map<string, { name: string; qty: number; amount: number; orders: Set<string> }>();
    for (const l of lines) {
      const c = cats.get(l.category) ?? { name: l.category, qty: 0, amount: 0, orders: new Set<string>() };
      c.qty += l.qty;
      c.amount += l.amount;
      for (const o of l.orders) c.orders.add(String(o));
      cats.set(l.category, c);
    }
    const categories = [...cats.values()]
      .map((c) => ({ name: c.name, qty: c.qty, amount: c.amount, orders: c.orders.size }))
      .sort((a, b) => b.amount - a.amount);
    return {
      period: publicPeriod(p),
      products,
      categories,
      totals: {
        qty: products.reduce((s, r) => s + r.qty, 0),
        amount: products.reduce((s, r) => s + r.amount, 0),
        products: products.length,
      },
    };
  }

  // ---------------------------------------------------------------- states

  async states(q: { from?: string; to?: string }): Promise<StateSalesReport> {
    const p = await this.period(q);
    const rows = await OrderModel.aggregate<{ _id: IndianStateCode; orders: number; sales: number }>([
      this.salesMatch(p),
      {
        $group: {
          _id: '$shippingAddress.stateCode',
          orders: { $sum: 1 },
          sales: { $sum: '$pricing.grandTotal' },
        },
      },
      { $sort: { sales: -1 } },
    ]);
    const out = rows.map((r) => ({
      stateCode: r._id,
      stateName: stateName(r._id),
      orders: r.orders,
      sales: r.sales,
      avgOrderValue: avg(r.sales, r.orders),
    }));
    return {
      period: publicPeriod(p),
      rows: out,
      totals: {
        orders: out.reduce((s, r) => s + r.orders, 0),
        sales: out.reduce((s, r) => s + r.sales, 0),
        states: out.length,
      },
    };
  }

  // ---------------------------------------------------------------- GST

  async gst(q: { from?: string; to?: string }): Promise<GstReport> {
    const p = await this.period(q);
    const range = { issuedAt: { $gte: p.start, $lte: p.end } };
    const [invoices, creditNotes, settings] = await Promise.all([
      InvoiceModel.find(range).sort({ issuedAt: 1, seq: 1 }).lean(),
      CreditNoteModel.find(range).sort({ issuedAt: 1, seq: 1 }).lean(),
      this.settings.get(),
    ]);
    type Doc = (typeof invoices)[number] | (typeof creditNotes)[number];
    const row = (d: Doc): GstDocumentRow => ({
      id: String(d._id),
      number: d.number,
      date: istDayOf(d.issuedAt),
      orderId: String(d.order),
      orderNo: d.orderNo,
      buyerName: d.buyer.name,
      buyerGstin: d.buyer.gstin ?? null,
      placeOfSupply: d.placeOfSupply,
      isInterState: d.isInterState,
      taxableValue: d.totals.taxableValue,
      cgst: d.totals.cgst,
      sgst: d.totals.sgst,
      igst: d.totals.igst,
      totalTax: d.totals.totalTax,
      total: d.totals.grandTotal,
    });

    const hsn = new Map<string, GstTaxTotals & { hsn: string; taxRate: number; qty: number; uqc: string }>();
    const units = new Map<string, Set<string>>();
    const rateLines: GstReport['rateLines'] = [];
    const rates = new Map<number, GstTaxTotals & { taxRate: number }>();
    const collect = (d: Doc, sign: 1 | -1) => {
      for (const h of d.hsnSummary) {
        const key = `${h.hsn}|${h.taxRate}`;
        const e = hsn.get(key) ?? { hsn: h.hsn, taxRate: h.taxRate, qty: 0, uqc: '', ...zeroTax() };
        const tax = h.cgst + h.sgst + h.igst;
        addTax(e, { ...h, totalTax: tax, total: h.taxableValue + tax }, sign);
        hsn.set(key, e);
        const r = rates.get(h.taxRate) ?? { taxRate: h.taxRate, ...zeroTax() };
        addTax(r, { ...h, totalTax: tax, total: h.taxableValue + tax }, sign);
        rates.set(h.taxRate, r);
      }
      for (const i of d.items) {
        const key = `${i.hsn}|${i.taxRate}`;
        const e = hsn.get(key);
        if (e) e.qty += sign * i.qty;
        units.set(key, (units.get(key) ?? new Set<string>()).add(i.unit));
      }
      // Per document, per rate (taxable value and tax from its HSN summary).
      const byRate = new Map<number, { taxableValue: number; cgst: number; sgst: number; igst: number }>();
      for (const h of d.hsnSummary) {
        const e = byRate.get(h.taxRate) ?? { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
        e.taxableValue += h.taxableValue;
        e.cgst += h.cgst;
        e.sgst += h.sgst;
        e.igst += h.igst;
        byRate.set(h.taxRate, e);
      }
      for (const [taxRate, t] of byRate)
        rateLines.push({ kind: sign === 1 ? 'invoice' : 'credit_note', number: d.number, taxRate, ...t });
    };
    invoices.forEach((d) => collect(d, 1));
    creditNotes.forEach((d) => collect(d, -1));

    const invoiceRows = invoices.map(row);
    const cnRows = creditNotes.map((d) => ({
      ...row(d),
      invoiceNumber: d.invoiceNumber,
      invoiceDate: istDayOf(d.invoiceDate),
      reason: d.reason ?? null,
    }));
    const sum = (rows: GstDocumentRow[]) => {
      const t = zeroTax();
      rows.forEach((r) => addTax(t, r));
      return { ...t, count: rows.length };
    };
    const inv = sum(invoiceRows);
    const cn = sum(cnRows);
    const net = zeroTax();
    addTax(net, inv);
    addTax(net, cn, -1);
    return {
      period: publicPeriod(p),
      sellerGstin: settings?.company?.gstin ?? null,
      b2clThreshold: settings?.tax?.b2clThreshold ?? null,
      invoices: invoiceRows,
      creditNotes: cnRows,
      rateLines,
      hsn: [...hsn.entries()]
        .map(([key, e]) => {
          const u = [...(units.get(key) ?? [])];
          return { ...e, uqc: u.length === 1 && u[0] ? (UQC_BY_UNIT[u[0]] ?? 'OTH') : 'OTH' };
        })
        .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.taxRate - b.taxRate),
      rates: [...rates.values()].sort((a, b) => a.taxRate - b.taxRate),
      totals: { invoices: inv, creditNotes: cn, net },
    };
  }

  // ---------------------------------------------------------------- payments

  async payments(q: { from?: string; to?: string }): Promise<PaymentsReport> {
    const p = await this.period(q);
    const [recorded, voided, open] = await Promise.all([
      PaymentModel.find({ status: 'recorded', paidAt: { $gte: p.start, $lte: p.end } })
        .sort({ paidAt: 1 })
        .lean(),
      PaymentModel.find({ status: 'voided', voidedAt: { $gte: p.start, $lte: p.end } })
        .sort({ voidedAt: 1 })
        .lean(),
      OrderModel.aggregate<{
        _id: Types.ObjectId;
        orderNo: string;
        name: string;
        phone: string;
        status: OrderStatus;
        confirmedAt: Date | null;
        total: number;
        paid: number;
      }>([
        { $match: { isDeleted: false, status: { $in: COMMITTED } } },
        { $match: { $expr: { $gt: ['$pricing.grandTotal', '$amountPaid'] } } },
        {
          $project: {
            orderNo: 1,
            name: '$customerSnapshot.name',
            phone: '$customerSnapshot.phone',
            status: 1,
            confirmedAt: 1,
            total: '$pricing.grandTotal',
            paid: '$amountPaid',
          },
        },
        { $sort: { confirmedAt: 1 } },
      ]),
    ]);
    const customerIds = [...new Set(recorded.map((r) => String(r.customer)))];
    const names = new Map(
      (
        await CustomerModel.find({ _id: { $in: customerIds } }, { name: 1 }, { withDeleted: true }).lean()
      ).map((c) => [String(c._id), c.name]),
    );
    const methods = new Map<PaymentMethod, PaymentsReport['byMethod'][number]>();
    for (const r of recorded) {
      const m = methods.get(r.method) ?? {
        method: r.method,
        payments: 0,
        received: 0,
        refunds: 0,
        refunded: 0,
        net: 0,
      };
      if (r.kind === 'refund') {
        m.refunds += 1;
        m.refunded += r.amount;
        m.net -= r.amount;
      } else {
        m.payments += 1;
        m.received += r.amount;
        m.net += r.amount;
      }
      methods.set(r.method, m);
    }
    const byMethod = [...methods.values()].sort((a, b) => b.net - a.net);
    const outstanding = open.map((o) => ({
      orderId: String(o._id),
      orderNo: o.orderNo,
      customer: o.name,
      phone: o.phone,
      status: o.status,
      confirmedAt: o.confirmedAt ? o.confirmedAt.toISOString() : null,
      total: o.total,
      paid: o.paid,
      due: o.total - o.paid,
    }));
    return {
      period: publicPeriod(p),
      byMethod,
      payments: recorded.map((r) => ({
        id: String(r._id),
        paidAt: r.paidAt.toISOString(),
        orderId: String(r.order),
        orderNo: r.orderNo,
        customer: names.get(String(r.customer)) ?? '',
        kind: r.kind,
        method: r.method,
        reference: r.reference ?? null,
        amount: r.amount,
        recordedBy: r.recordedBy?.name ?? null,
      })),
      voided: voided.map((r) => ({
        id: String(r._id),
        voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
        orderId: String(r.order),
        orderNo: r.orderNo,
        method: r.method,
        reference: r.reference ?? null,
        amount: r.amount,
        reason: r.voidReason ?? null,
        voidedBy: r.voidedBy?.name ?? null,
      })),
      outstanding,
      totals: {
        received: byMethod.reduce((s, m) => s + m.received, 0),
        refunded: byMethod.reduce((s, m) => s + m.refunded, 0),
        net: byMethod.reduce((s, m) => s + m.net, 0),
        voided: voided.reduce((s, v) => s + v.amount, 0),
        outstanding: outstanding.reduce((s, o) => s + o.due, 0),
      },
    };
  }

  // ---------------------------------------------------------------- dispatch

  async dispatch(q: { from?: string; to?: string }): Promise<DispatchReport> {
    const p = await this.period(q);
    const orders = await OrderModel.find(
      {
        isDeleted: false,
        'dispatch.dispatchDate': { $gte: p.start, $lte: p.end },
        'dispatch.lrNumber': { $exists: true, $ne: null },
      },
      { orderNo: 1, status: 1, customerSnapshot: 1, shippingAddress: 1, dispatch: 1 },
    )
      .sort({ 'dispatch.dispatchDate': 1, orderNo: 1 })
      .lean();
    const rows = orders.map((o) => ({
      orderId: String(o._id),
      orderNo: o.orderNo,
      dispatchDate: o.dispatch?.dispatchDate ? istDayOf(o.dispatch.dispatchDate) : '',
      customer: o.customerSnapshot.name,
      city: o.shippingAddress.city,
      stateCode: o.shippingAddress.stateCode,
      transportName: o.dispatch?.transportName ?? '',
      lrNumber: o.dispatch?.lrNumber ?? '',
      boxes: o.dispatch?.boxes ?? 0,
      weightKg: o.dispatch?.weightKg ?? null,
      status: o.status,
    }));
    const partners = new Map<string, { transportName: string; orders: number; boxes: number }>();
    for (const r of rows) {
      const e = partners.get(r.transportName) ?? { transportName: r.transportName, orders: 0, boxes: 0 };
      e.orders += 1;
      e.boxes += r.boxes;
      partners.set(r.transportName, e);
    }
    return {
      period: publicPeriod(p),
      byPartner: [...partners.values()].sort((a, b) => b.orders - a.orders),
      rows,
      totals: { orders: rows.length, boxes: rows.reduce((s, r) => s + r.boxes, 0) },
    };
  }

  // ---------------------------------------------------------------- stock

  async stock(q: { from?: string; to?: string }): Promise<StockReport> {
    const p = await this.period(q);
    const [products, categories, moves] = await Promise.all([
      ProductModel.find(
        {},
        { sku: 1, name: 1, type: 1, category: 1, stock: 1, netPrice: 1, lowStockThreshold: 1, isActive: 1 },
      )
        .sort({ name: 1 })
        .lean(),
      CategoryModel.find({}, { name: 1 }).lean(),
      StockMovementModel.aggregate<{
        _id: { product: Types.ObjectId; type: StockMovementType };
        qty: number;
      }>([
        { $match: { createdAt: { $gte: p.start, $lte: p.end } } },
        { $group: { _id: { product: '$product', type: '$type' }, qty: { $sum: '$qty' } } },
      ]),
    ]);
    const catName = new Map(categories.map((c) => [String(c._id), c.name]));
    const moved = new Map<string, Record<StockMovementType, number>>();
    for (const m of moves) {
      const key = String(m._id.product);
      const e =
        moved.get(key) ??
        (Object.fromEntries(STOCK_MOVEMENT_TYPES.map((t) => [t, 0])) as Record<StockMovementType, number>);
      e[m._id.type] += m.qty;
      moved.set(key, e);
    }
    const empty = () =>
      Object.fromEntries(STOCK_MOVEMENT_TYPES.map((t) => [t, 0])) as Record<StockMovementType, number>;
    const rows = products.map((pr) => ({
      productId: String(pr._id),
      sku: pr.sku,
      name: pr.name,
      category: catName.get(String(pr.category)) ?? '',
      type: pr.type,
      stock: pr.stock,
      netPrice: pr.netPrice,
      value: pr.stock * pr.netPrice,
      isLow: pr.lowStockThreshold != null && pr.lowStockThreshold > 0 && pr.stock <= pr.lowStockThreshold,
      isActive: pr.isActive,
      movements: moved.get(String(pr._id)) ?? empty(),
    }));
    let movedIn = 0;
    let movedOut = 0;
    for (const r of rows)
      for (const v of Object.values(r.movements)) {
        if (v > 0) movedIn += v;
        else movedOut -= v;
      }
    return {
      period: publicPeriod(p),
      rows,
      totals: {
        products: rows.length,
        units: rows.reduce((s, r) => s + r.stock, 0),
        value: rows.reduce((s, r) => s + r.value, 0),
        movedIn,
        movedOut,
      },
    };
  }
}
