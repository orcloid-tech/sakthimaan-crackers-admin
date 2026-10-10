import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ClipboardList,
  IndianRupee,
  Package,
  PackageX,
  PenLine,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { ORDER_STATUSES } from '@sakthimaan/shared';
import { ErrorState, PageHeader } from '@/components/common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { money, number, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDemand, useLowStock, useProducts } from '../catalog/api';
import { useDashboard } from '../orders/api';
import { OrderStatusBadge, stateName } from '../orders/order-bits';

function Kpi({
  label,
  value,
  icon: Icon,
  hint,
  to,
  tone = 'default',
  pending,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  hint?: ReactNode;
  to?: string;
  tone?: 'default' | 'warn' | 'muted';
  pending?: boolean;
}) {
  const body = (
    <Card className={cn('h-full transition-colors', to && 'hover:border-primary/50')}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardDescription>{label}</CardDescription>
        <Icon
          className={cn('size-4', tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground')}
          aria-hidden
        />
      </CardHeader>
      <CardContent>
        {pending ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p
            className={cn('text-2xl font-semibold tabular-nums', tone === 'muted' && 'text-muted-foreground')}
          >
            {value}
          </p>
        )}
        {hint && !pending ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="focus-visible:ring-ring/50 rounded-xl outline-none focus-visible:ring-2">
      {body}
    </Link>
  ) : (
    body
  );
}

/** "▲ 12% vs Diwali 2025 at this point" (same number of days into the season). */
function Growth({ now, before, label }: { now: number; before: number; label: string }) {
  if (before <= 0) return <>{label}</>;
  const pct = Math.round(((now - before) / before) * 100);
  return (
    <span
      className={pct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}
    >
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs {label}
    </span>
  );
}

function ListCard({
  title,
  description,
  children,
  empty,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {empty ? <p className="text-muted-foreground text-sm">Nothing yet this season.</p> : children}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const canProducts = can('products:read');
  const canStock = can('inventory:read');
  const canOrders = can('orders:read');
  const summary = useDashboard(30, can('dashboard:read'));
  const d = summary.data;
  const active = useProducts(canProducts ? { isActive: true, pageSize: 1 } : { pageSize: 1 });
  const drafts = useProducts({ isActive: false, pageSize: 1 });
  const low = useLowStock({ pageSize: 1 });
  const short = useDemand({ onlyShort: true, pageSize: 1 });
  const total = (meta: unknown) => (meta as { total?: number } | undefined)?.total ?? 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const pending = summary.isPending;
  const seasonName = d?.season.name ?? 'Last 30 days';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.name.split(' ')[0] ?? ''}`}
        description={
          d
            ? `${seasonName}. Sales count confirmed orders; collections count recorded payments.`
            : 'Season overview.'
        }
      />

      {summary.isError ? (
        <div className="mb-4">
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </div>
      ) : null}

      <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Today's sales"
          value={money(d?.today.sales ?? 0)}
          pending={pending}
          icon={IndianRupee}
          hint={d ? `${plural(d.today.orders, 'order')} · ${money(d.today.collected)} collected` : undefined}
        />
        <Kpi
          label={`Sales · ${seasonName}`}
          value={money(d?.season.sales ?? 0)}
          pending={pending}
          icon={TrendingUp}
          hint={
            d ? (
              <>
                {plural(d.season.orders, 'order')} · {money(d.season.collected)} collected
                {d.lastSeason ? (
                  <>
                    <br />
                    <Growth
                      now={d.season.sales}
                      before={d.lastSeason.toSameDay}
                      label={`${d.lastSeason.name} at this point`}
                    />
                  </>
                ) : null}
              </>
            ) : undefined
          }
        />
        <Kpi
          label="Pending enquiries"
          value={number(d?.pendingEnquiries ?? 0)}
          pending={pending}
          icon={ClipboardList}
          tone={(d?.pendingEnquiries ?? 0) > 0 ? 'warn' : 'default'}
          to={canOrders ? '/orders?status=enquiry' : undefined}
          hint="Waiting to be called and confirmed"
        />
        <Kpi
          label="Awaiting payment"
          value={money(d?.awaitingPayment.amount ?? 0)}
          pending={pending}
          icon={Wallet}
          tone={(d?.awaitingPayment.orders ?? 0) > 0 ? 'warn' : 'default'}
          to={canOrders ? '/orders?payment=unpaid' : undefined}
          hint={d ? `Across ${plural(d.awaitingPayment.orders, 'confirmed order')}` : undefined}
        />
        {canProducts ? (
          <Kpi
            label="Active products"
            value={number(total(active.data?.meta))}
            pending={active.isPending}
            icon={Package}
            to="/products?status=active"
            hint={
              total(drafts.data?.meta) > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <PenLine className="size-3" aria-hidden /> {total(drafts.data?.meta)} draft(s) waiting for
                  approval
                </span>
              ) : (
                'No drafts waiting'
              )
            }
          />
        ) : null}
        {canStock ? (
          <>
            <Kpi
              label="Low stock"
              value={number(total(low.data?.meta))}
              pending={low.isPending}
              icon={PackageX}
              tone={total(low.data?.meta) > 0 ? 'warn' : 'default'}
              to="/inventory?tab=low"
              hint="At or below alert level"
            />
            <Kpi
              label="Short for enquiries"
              value={number(total(short.data?.meta))}
              pending={short.isPending}
              icon={AlertTriangle}
              tone={total(short.data?.meta) > 0 ? 'warn' : 'default'}
              to="/inventory?tab=demand"
              hint="Products with more on enquiries than in stock"
            />
          </>
        ) : null}
      </section>

      {d ? (
        <section aria-label="Breakdown" className="mt-6 grid gap-3 lg:grid-cols-3">
          <ListCard
            title="Orders by status"
            description="Created this season"
            empty={Object.keys(d.ordersByStatus).length === 0}
          >
            <ul className="grid gap-2 text-sm">
              {ORDER_STATUSES.filter((s) => d.ordersByStatus[s]).map((s) => (
                <li key={s} className="flex items-center justify-between">
                  {canOrders ? (
                    <Link to={`/orders?status=${s}`} className="rounded-md hover:opacity-80">
                      <OrderStatusBadge status={s} />
                    </Link>
                  ) : (
                    <OrderStatusBadge status={s} />
                  )}
                  <span className="tabular-nums">{number(d.ordersByStatus[s] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </ListCard>
          <ListCard
            title="Top products"
            description="By sales this season"
            empty={d.topProducts.length === 0}
          >
            <ol className="grid gap-2 text-sm">
              {d.topProducts.map((p) => (
                <li key={p.productId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {money(p.sales)}{' '}
                    <span className="text-muted-foreground text-xs">· {number(p.qty)} sold</span>
                  </span>
                </li>
              ))}
            </ol>
          </ListCard>
          <ListCard title="Sales by state" description="This season" empty={d.byState.length === 0}>
            <ul className="grid gap-2 text-sm">
              {d.byState.slice(0, 8).map((s) => (
                <li key={s.stateCode} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{stateName(s.stateCode)}</span>
                  <span className="shrink-0 tabular-nums">
                    {money(s.sales)}{' '}
                    <span className="text-muted-foreground text-xs">· {plural(s.orders, 'order')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </ListCard>
        </section>
      ) : null}
    </>
  );
}
