import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  adminOrderCreateSchema,
  DashboardSummary,
  dispatchSchema,
  IndianStateCode,
  OffsetPageMeta,
  OrderDto,
  OrderListItem,
  OrderStatus,
  OrderUpdateInput,
  PricingPreview,
  WhatsAppEvent,
} from '@sakthimaan/shared';
import { api, type Query } from '@/lib/api';
import { keys as catalogKeys } from '../catalog/api';

/** Request bodies as sent (dates as strings, defaults optional). */
export type OrderCreateBody = z.input<typeof adminOrderCreateSchema>;
export type DispatchBody = z.input<typeof dispatchSchema>;

export const orderKeys = {
  all: ['orders'] as const,
  list: (q: Query) => ['orders', 'list', q] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  preview: (body: unknown) => ['orders', 'preview', body] as const,
  dashboard: (days: number) => ['dashboard', days] as const,
};

export interface CustomerLookup {
  id: string;
  name: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  gstin: string | null;
  isBlocked: boolean;
  creditAllowed: boolean;
  orderCount: number;
  addresses: {
    line1: string;
    line2?: string | null;
    landmark?: string | null;
    city: string;
    district?: string | null;
    stateCode: IndianStateCode;
    pincode: string;
  }[];
}

export interface TransportPartner {
  id: string;
  name: string;
  phones: string[];
  servedStates: IndianStateCode[];
}

export function useOrders(q: Query) {
  return useQuery({
    queryKey: orderKeys.list(q),
    queryFn: ({ signal }) => api.get<OrderListItem[], OffsetPageMeta>('/orders', q, signal),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: async ({ signal }) => (await api.get<OrderDto>(`/orders/${id}`, undefined, signal)).data,
    enabled: !!id,
  });
}

/** Live totals for a list of lines; prices always come from the server. */
export function usePricingPreview(body: {
  stateCode: IndianStateCode | '';
  city?: string;
  items: { productId: string; qty: number }[];
}) {
  const ready = body.stateCode !== '' && body.items.length > 0;
  return useQuery({
    queryKey: orderKeys.preview(body),
    queryFn: async () => (await api.post<PricingPreview>('/orders/preview', body)).data,
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useCustomerLookup(phone: string) {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return useQuery({
    queryKey: ['customers', 'lookup', digits],
    queryFn: async () => (await api.get<CustomerLookup | null>('/customers/lookup', { phone: digits })).data,
    enabled: /^[6-9]\d{9}$/.test(digits),
    staleTime: 60_000,
  });
}

export function useTransportPartners(enabled = true) {
  return useQuery({
    queryKey: ['transport-partners'],
    queryFn: async () => (await api.get<TransportPartner[]>('/transport-partners')).data,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDashboard(days = 30, enabled = true) {
  return useQuery({
    queryKey: orderKeys.dashboard(days),
    queryFn: async () => (await api.get<DashboardSummary>('/dashboard/summary', { days })).data,
    enabled,
    staleTime: 60_000,
  });
}

export function useOrderMutations(id?: string) {
  const qc = useQueryClient();
  const settle = (order?: OrderDto) => {
    if (order) qc.setQueryData(orderKeys.detail(order.id), order);
    void qc.invalidateQueries({ queryKey: orderKeys.all });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const stockChanged = () => void qc.invalidateQueries({ queryKey: catalogKeys.inventory });
  const path = `/orders/${id ?? ''}`;
  return {
    create: useMutation({
      mutationFn: async (body: OrderCreateBody) => (await api.post<OrderDto>('/orders', body)).data,
      onSuccess: settle,
    }),
    update: useMutation({
      mutationFn: async (body: OrderUpdateInput) => (await api.patch<OrderDto>(path, body)).data,
      onSuccess: settle,
    }),
    transition: useMutation({
      mutationFn: async (body: { to: OrderStatus; version: number; reason?: string }) =>
        (await api.post<OrderDto>(`${path}/transitions`, body)).data,
      onSuccess: (o) => {
        settle(o);
        stockChanged();
        void qc.invalidateQueries({ queryKey: catalogKeys.products });
      },
    }),
    comment: useMutation({
      mutationFn: async (body: { message: string; isInternal: boolean }) =>
        (await api.post<OrderDto>(`${path}/comments`, body)).data,
      onSuccess: settle,
    }),
    recordPayment: useMutation({
      mutationFn: async (form: FormData) =>
        (await api.upload<{ order: OrderDto; warnings: string[] }>(`${path}/payments`, form)).data,
      onSuccess: (r) => settle(r.order),
    }),
    voidPayment: useMutation({
      mutationFn: async ({ paymentId, reason }: { paymentId: string; reason: string }) =>
        (await api.post<OrderDto>(`/payments/${paymentId}/void`, { reason })).data,
      onSuccess: settle,
    }),
    dispatch: useMutation({
      mutationFn: async (body: DispatchBody) => (await api.put<OrderDto>(`${path}/dispatch`, body)).data,
      onSuccess: settle,
    }),
    invoice: useMutation({
      mutationFn: async () => (await api.post<OrderDto>(`${path}/invoice`)).data,
      onSuccess: settle,
    }),
  };
}

export async function whatsappLink(id: string, event: WhatsAppEvent) {
  return (
    await api.get<{ url: string; message: string; phone: string }>(`/orders/${id}/whatsapp-link`, { event })
  ).data;
}
