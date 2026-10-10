import type { LucideIcon } from 'lucide-react';
import { ClipboardList, Package, Phone } from 'lucide-react';
import type { OrderListItem, Permission, ProductDto } from '@sakthimaan/shared';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  to: string;
}

export interface SearchSource {
  key: string;
  label: string;
  placeholder: string;
  icon: LucideIcon;
  /** The user needs all of these to see this group. */
  permissions: Permission[];
  /** Skip the request when the text can't match (e.g. phone search needs digits). */
  matches: (q: string) => boolean;
  search: (q: string, signal: AbortSignal) => Promise<SearchResult[]>;
}

const STATUS: Record<OrderListItem['status'], string> = {
  enquiry: 'Enquiry',
  confirmed: 'Confirmed',
  payment_received: 'Paid',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const digitsOf = (q: string) => q.replace(/\D/g, '');
/** Only digits, spaces, + and - with at least 5 digits: a (partial) phone number. */
const isPhoneLike = (q: string) => /^[+\d\s-]+$/.test(q) && digitsOf(q).length >= 5;
/** "ORD/26-27/000042", "ord 42", "000042", "42": an order number or its tail. */
const isOrderLike = (q: string) => /^ord\b/i.test(q) || /^[\d/-]{1,16}$/.test(q.trim());

/** Sources for the header search. Modules add theirs here. */
export const searchSources: SearchSource[] = [
  {
    key: 'orders',
    label: 'Orders',
    placeholder: 'order number',
    icon: ClipboardList,
    permissions: ['orders:read'],
    matches: (q) => isOrderLike(q) && !isPhoneLike(q),
    search: async (q, signal) => {
      const res = await api.get<OrderListItem[]>('/orders', { q, pageSize: 6 }, signal);
      return res.data.map((o) => ({
        id: o.id,
        title: o.orderNo,
        subtitle: `${o.customer.name} · ${STATUS[o.status]}`,
        meta: money(o.grandTotal),
        to: `/orders/${o.id}`,
      }));
    },
  },
  {
    key: 'phone',
    label: 'Customers by phone',
    placeholder: 'customer phone',
    icon: Phone,
    permissions: ['orders:read'],
    matches: isPhoneLike,
    search: async (q, signal) => {
      const digits = digitsOf(q).replace(/^(91|0)(?=\d{10}$)/, '');
      const res = await api.get<OrderListItem[]>('/orders', { q: digits, pageSize: 25 }, signal);
      // One row per customer, linking to their orders.
      const byCustomer = new Map<string, { o: OrderListItem; count: number }>();
      for (const o of res.data) {
        const hit = byCustomer.get(o.customer.id);
        if (hit) hit.count += 1;
        else byCustomer.set(o.customer.id, { o, count: 1 });
      }
      return [...byCustomer.values()].slice(0, 6).map(({ o, count }) => ({
        id: o.customer.id,
        title: o.customer.name,
        subtitle: `${o.customer.phone} · ${o.city}`,
        meta: count === 1 ? '1 order' : `${count} orders`,
        to: `/orders?q=${o.customer.phone}`,
      }));
    },
  },
  {
    key: 'products',
    label: 'Products',
    placeholder: 'product name or SKU',
    icon: Package,
    permissions: ['products:read'],
    matches: () => true,
    search: async (q, signal) => {
      const res = await api.get<ProductDto[]>('/products', { q, pageSize: 8, sort: 'name' }, signal);
      return res.data.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.sku}${p.isActive ? '' : ' · Draft'}`,
        meta: money(p.netPrice),
        to: p.type === 'combo' ? `/gift-boxes/${p.id}` : `/products/${p.id}`,
      }));
    },
  },
];
