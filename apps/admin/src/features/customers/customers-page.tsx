import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { INDIAN_STATES, type CustomerListItem } from '@sakthimaan/shared';
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { FilterBar } from '@/components/responsive';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { dateTime, money, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCustomers } from '../settings/api';

const PAGE_SIZE = 25;
const SORTS = {
  recent: 'Last order',
  spend: 'Total spent',
  orders: 'Most orders',
  name: 'Name',
  created: 'Newest',
} as const;

export function CustomerFlags({ c }: { c: Pick<CustomerListItem, 'isBlocked' | 'creditAllowed'> }) {
  return (
    <>
      {c.isBlocked ? <Badge variant="destructive">Blocked</Badge> : null}
      {c.creditAllowed ? (
        <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
          Credit
        </Badge>
      ) : null}
    </>
  );
}

/** Customers, created automatically from orders (one per mobile number). */
export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);
  const page = Number(params.get('page') ?? '1') || 1;
  const status = params.get('status') ?? 'all';
  const sort = (params.get('sort') ?? 'recent') as keyof typeof SORTS;
  const stateCode = params.get('state') ?? 'all';
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '' || (key !== 'sort' && value === 'all')) next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const list = useCustomers({
    q: q || undefined,
    status,
    sort,
    stateCode: stateCode === 'all' ? undefined : stateCode,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Customers"
        description="Added automatically when someone places an order or enquiry."
      />
      <FilterBar
        active={(status !== 'all' ? 1 : 0) + (stateCode !== 'all' ? 1 : 0)}
        onClear={() => {
          const next = new URLSearchParams();
          if (q) next.set('q', q);
          if (params.get('sort')) next.set('sort', sort);
          setParams(next, { replace: true });
        }}
        search={
          <div className="relative lg:w-72">
            <Search
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search customers"
              placeholder="Name, phone, email, GSTIN or tag"
              className="pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam('q', e.target.value.trim() || null);
              }}
              enterKeyHint="search"
            />
          </div>
        }
      >
        <Select value={status} onValueChange={(v) => setParam('status', v)}>
          <SelectTrigger className="w-full md:w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="credit">Credit allowed</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setParam('sort', v)}>
          <SelectTrigger className="w-full md:w-40" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORTS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stateCode} onValueChange={(v) => setParam('state', v)}>
          <SelectTrigger className="w-full md:w-44" aria-label="State">
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
      </FilterBar>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState title={q || status !== 'all' ? 'No customers match' : 'No customers yet'} />
      ) : (
        <div className={cn(list.isFetching && 'opacity-70 transition-opacity')}>
          <ul className="grid gap-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/customers/${c.id}`}
                  className="bg-card hover:border-primary/50 block rounded-xl border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="text-muted-foreground text-sm">
                        {c.phone}
                        {c.city ? ` · ${c.city}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{money(c.totalSpent)}</p>
                      <p className="text-muted-foreground text-xs">{c.orderCount} confirmed</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <CustomerFlags c={c} />
                    {c.tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {c.lastOrderAt ? dateTime(c.lastOrderAt) : 'No orders'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Confirmed orders</TableHead>
                  <TableHead className="text-right">Total paid</TableHead>
                  <TableHead>Last order</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/customers/${c.id}`)}
                  >
                    <TableCell>
                      <Link
                        to={`/customers/${c.id}`}
                        className="hover:text-primary font-medium underline-offset-4 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">{c.phone}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {[c.city, c.stateCode].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{number(c.orderCount)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {money(c.totalSpent)}
                    </TableCell>
                    <TableCell className="text-sm">{c.lastOrderAt ? dateTime(c.lastOrderAt) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <CustomerFlags c={c} />
                        {c.tags.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data?.meta?.total ?? 0}
            onPage={(p) => setParam('page', String(p))}
          />
        </div>
      )}
    </>
  );
}
