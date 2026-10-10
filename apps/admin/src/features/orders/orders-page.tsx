import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import {
  INDIAN_STATES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderListItem,
  type PaymentStatus,
} from '@sakthimaan/shared';
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '@/components/common';
import { Can } from '@/components/guards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { dateTime, money, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrders } from './api';
import { OrderStatusBadge, PAYMENT_LABEL, PaymentBadge, STATUS_LABEL } from './order-bits';

const PAGE_SIZE = 25;

/** IST calendar date (yyyy-mm-dd) → start / end of that day as ISO instants. */
const istDay = (d: string, end: boolean) =>
  d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}+05:30`).toISOString() : undefined;

function Due({ o }: { o: OrderListItem }) {
  const due = o.grandTotal - o.amountPaid;
  if (o.status === 'cancelled' || o.status === 'enquiry' || due <= 0) return null;
  return <span className="text-xs text-amber-700 dark:text-amber-400">Due {money(due)}</span>;
}

/** Orders and enquiries. Filters live in the URL so a filtered view can be shared or bookmarked. */
export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);
  const page = Number(params.get('page') ?? '1') || 1;
  const status = params.get('status') ?? 'all';
  const paymentStatus = params.get('payment') ?? 'all';
  const stateCode = params.get('state') ?? 'all';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '' || value === 'all') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const list = useOrders({
    q: q || undefined,
    status: status === 'all' ? undefined : status,
    paymentStatus: paymentStatus === 'all' ? undefined : paymentStatus,
    stateCode: stateCode === 'all' ? undefined : stateCode,
    from: istDay(from, false),
    to: istDay(to, true),
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = list.data?.data ?? [];
  const total = list.data?.meta?.total ?? 0;
  const filtered =
    status !== 'all' || paymentStatus !== 'all' || stateCode !== 'all' || !!from || !!to || !!q;

  return (
    <>
      <PageHeader
        title="Orders & enquiries"
        description="Website and phone orders. Stock is deducted when an order is confirmed."
        actions={
          <Can allOf={['orders:create']}>
            <Button onClick={() => navigate('/orders/new')}>
              <Plus /> New order
            </Button>
          </Can>
        }
      />

      {/* Status chips: the most used filter, one tap on a phone. */}
      <div
        className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        role="group"
        aria-label="Status"
      >
        {(['all', ...ORDER_STATUSES] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            className="shrink-0 rounded-full"
            aria-pressed={status === s}
            onClick={() => setParam('status', s)}
          >
            {s === 'all' ? 'All' : STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-end">
        <div className="relative col-span-2 lg:w-72">
          <Search
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search orders"
            placeholder="Order no., phone, name or LR"
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setParam('q', e.target.value.trim() || null);
            }}
          />
        </div>
        <Select value={paymentStatus} onValueChange={(v) => setParam('payment', v)}>
          <SelectTrigger className="w-full lg:w-36" aria-label="Payment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any payment</SelectItem>
            {PAYMENT_STATUSES.map((p: PaymentStatus) => (
              <SelectItem key={p} value={p}>
                {PAYMENT_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stateCode} onValueChange={(v) => setParam('state', v)}>
          <SelectTrigger className="w-full lg:w-44" aria-label="State">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {INDIAN_STATES.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
          <Input
            type="date"
            aria-label="From date"
            className="min-w-0 lg:w-40"
            value={from}
            max={to || undefined}
            onChange={(e) => setParam('from', e.target.value)}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            aria-label="To date"
            className="min-w-0 lg:w-40"
            value={to}
            min={from || undefined}
            onChange={(e) => setParam('to', e.target.value)}
          />
        </div>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            <X /> Clear
          </Button>
        ) : null}
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No orders match' : 'No orders yet'}
          description={
            filtered
              ? 'Try another filter or search.'
              : 'Website enquiries and phone orders will appear here.'
          }
        />
      ) : (
        <div className={cn(list.isFetching && 'opacity-70 transition-opacity')}>
          {/* Phones: cards */}
          <ul className="grid gap-2 md:hidden">
            {rows.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/orders/${o.id}`}
                  className="bg-card hover:border-primary/50 focus-visible:ring-ring/50 block rounded-xl border p-3 outline-none focus-visible:ring-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium">{o.orderNo}</p>
                      <p className="truncate">{o.customer.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {o.customer.phone} · {o.city}, {o.stateCode}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{money(o.grandTotal)}</p>
                      <Due o={o} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <OrderStatusBadge status={o.status} />
                    <PaymentBadge status={o.paymentStatus} />
                    <span className="text-muted-foreground ml-auto text-xs">{dateTime(o.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablets and up: table */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(`/orders/${o.id}`)}>
                    <TableCell>
                      <Link
                        to={`/orders/${o.id}`}
                        className="hover:text-primary font-mono text-sm font-medium underline-offset-4 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.orderNo}
                      </Link>
                      <p className="text-muted-foreground text-xs">{dateTime(o.createdAt)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-48 truncate">{o.customer.name}</p>
                      <p className="text-muted-foreground text-xs">{o.customer.phone}</p>
                    </TableCell>
                    <TableCell>
                      <p>{o.city}</p>
                      <p className="text-muted-foreground text-xs">
                        {o.stateCode}
                        {o.lrNumber ? ` · LR ${o.lrNumber}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(o.itemCount)}
                      <p className="text-muted-foreground text-xs">{number(o.totalQty)} qty</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <p className="font-medium tabular-nums">{money(o.grandTotal)}</p>
                      <Due o={o} />
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell>
                      <PaymentBadge status={o.paymentStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPage={(p) => setParam('page', String(p))}
          />
        </div>
      )}
    </>
  );
}
