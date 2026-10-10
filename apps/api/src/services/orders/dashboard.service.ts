import type { PipelineStage } from 'mongoose';
import {
  STOCK_COMMITTED_STATUSES,
  type DashboardSummary,
  type IndianStateCode,
  type OrderStatus,
} from '@sakthimaan/shared';
import { OrderModel, PaymentModel, SeasonModel } from '../../models/index.js';

const TZ = 'Asia/Kolkata';
const CACHE_MS = 60_000;

/** Start of "today" in IST, as a UTC instant. */
function istStartOfDay(d = new Date()): Date {
  const ist = new Date(d.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}

const dayKey = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Dashboard figures. "Sales" = grand total of confirmed (not cancelled) orders by
 * confirmation date; "collected" = recorded payments minus refunds by payment date.
 * Cached in memory for a minute (no Redis by decision).
 */
export class DashboardService {
  private cache = new Map<number, { at: number; value: DashboardSummary }>();

  async summary(days: number, refresh = false): Promise<DashboardSummary> {
    const hit = this.cache.get(days);
    if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await this.compute(days);
    this.cache.set(days, { at: Date.now(), value });
    return value;
  }

  private async compute(days: number): Promise<DashboardSummary> {
    const now = new Date();
    const today = istStartOfDay(now);
    const seasons = await SeasonModel.find().sort({ startDate: -1 }).lean();
    const current =
      seasons.find((s) => s.startDate <= now && s.endDate >= now) ??
      seasons.find((s) => s.startDate <= now) ??
      null;
    const seasonFrom = current?.startDate ?? new Date(today.getTime() - 30 * 86_400_000);
    const seasonTo = current?.endDate && current.endDate < now ? current.endDate : now;
    const previous = current ? (seasons.find((s) => s.startDate < current.startDate) ?? null) : null;
    const committed = [...STOCK_COMMITTED_STATUSES];
    const chartFrom = new Date(today.getTime() - (days - 1) * 86_400_000);

    const sales = async (from: Date, to: Date) => {
      const [r] = await OrderModel.aggregate<{ sales: number; orders: number }>([
        { $match: { isDeleted: false, status: { $in: committed }, confirmedAt: { $gte: from, $lte: to } } },
        { $group: { _id: null, sales: { $sum: '$pricing.grandTotal' }, orders: { $sum: 1 } } },
      ]);
      return { sales: r?.sales ?? 0, orders: r?.orders ?? 0 };
    };
    const collected = async (from: Date, to: Date) => {
      const [r] = await PaymentModel.aggregate<{ amount: number }>([
        { $match: { status: 'recorded', paidAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: null,
            amount: {
              $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] },
            },
          },
        },
      ]);
      return r?.amount ?? 0;
    };
    const itemMatch: PipelineStage.Match = {
      $match: {
        isDeleted: false,
        status: { $in: committed },
        confirmedAt: { $gte: seasonFrom, $lte: seasonTo },
      },
    };

    const [
      todaySales,
      todayCollected,
      seasonSales,
      seasonCollected,
      statusRows,
      awaiting,
      daily,
      top,
      byCategory,
      byState,
      lastSeason,
    ] = await Promise.all([
      sales(today, now),
      collected(today, now),
      sales(seasonFrom, seasonTo),
      collected(seasonFrom, seasonTo),
      OrderModel.aggregate<{ _id: OrderStatus; n: number }>([
        { $match: { isDeleted: false, createdAt: { $gte: seasonFrom } } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      OrderModel.aggregate<{ orders: number; amount: number }>([
        { $match: { isDeleted: false, status: { $in: committed }, paymentStatus: { $ne: 'paid' } } },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            amount: { $sum: { $subtract: ['$pricing.grandTotal', '$amountPaid'] } },
          },
        },
      ]),
      OrderModel.aggregate<{ _id: string; sales: number; orders: number }>([
        { $match: { isDeleted: false, status: { $in: committed }, confirmedAt: { $gte: chartFrom } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$confirmedAt', timezone: TZ } },
            sales: { $sum: '$pricing.grandTotal' },
            orders: { $sum: 1 },
          },
        },
      ]),
      OrderModel.aggregate<{ _id: string; name: string; sku: string; qty: number; sales: number }>([
        itemMatch,
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            sku: { $first: '$items.sku' },
            qty: { $sum: '$items.qty' },
            sales: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { sales: -1 } },
        { $limit: 5 },
      ]),
      OrderModel.aggregate<{ _id: string; sales: number }>([
        itemMatch,
        { $unwind: '$items' },
        { $group: { _id: '$items.categoryName', sales: { $sum: '$items.lineTotal' } } },
        { $sort: { sales: -1 } },
      ]),
      OrderModel.aggregate<{ _id: IndianStateCode; orders: number; sales: number }>([
        itemMatch,
        {
          $group: {
            _id: '$shippingAddress.stateCode',
            orders: { $sum: 1 },
            sales: { $sum: '$pricing.grandTotal' },
          },
        },
        { $sort: { sales: -1 } },
      ]),
      previous
        ? (async () => {
            const total = await sales(previous.startDate, previous.endDate);
            const elapsed = now.getTime() - (current?.startDate.getTime() ?? now.getTime());
            const same = await sales(
              previous.startDate,
              new Date(Math.min(previous.endDate.getTime(), previous.startDate.getTime() + elapsed)),
            );
            return { name: previous.name, sales: total.sales, orders: total.orders, toSameDay: same.sales };
          })()
        : Promise.resolve(null),
    ]);

    const dailyMap = new Map(daily.map((d) => [d._id, d]));
    const series: DashboardSummary['daily'] = [];
    for (let i = 0; i < days; i++) {
      const key = dayKey(new Date(chartFrom.getTime() + i * 86_400_000 + 12 * 3_600_000));
      const row = dailyMap.get(key);
      series.push({ date: key, sales: row?.sales ?? 0, orders: row?.orders ?? 0 });
    }

    const ordersByStatus: DashboardSummary['ordersByStatus'] = {};
    for (const r of statusRows) ordersByStatus[r._id] = r.n;
    const pendingEnquiries = await OrderModel.countDocuments({ status: 'enquiry' });

    return {
      generatedAt: now.toISOString(),
      today: { sales: todaySales.sales, collected: todayCollected, orders: todaySales.orders },
      season: {
        name: current?.name ?? null,
        from: seasonFrom.toISOString(),
        to: seasonTo.toISOString(),
        sales: seasonSales.sales,
        collected: seasonCollected,
        orders: seasonSales.orders,
      },
      lastSeason,
      ordersByStatus,
      pendingEnquiries,
      awaitingPayment: { orders: awaiting[0]?.orders ?? 0, amount: awaiting[0]?.amount ?? 0 },
      daily: series,
      topProducts: top.map((t) => ({
        productId: String(t._id),
        name: t.name,
        sku: t.sku,
        qty: t.qty,
        sales: t.sales,
      })),
      byCategory: byCategory.map((c) => ({ name: c._id, sales: c.sales })),
      byState: byState.map((s) => ({ stateCode: s._id, orders: s.orders, sales: s.sales })),
    };
  }
}
