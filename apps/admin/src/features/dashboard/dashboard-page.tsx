import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  IndianRupee,
  Package,
  PackageX,
  PenLine,
  TrendingUp,
} from 'lucide-react';
import { PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDemand, useLowStock, useProducts } from '../catalog/api';

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
          <p className={cn('text-2xl font-semibold', tone === 'muted' && 'text-muted-foreground')}>{value}</p>
        )}
        {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
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

function Soon() {
  return (
    <Badge variant="outline" className="text-[10px]">
      With Orders module
    </Badge>
  );
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const canProducts = can('products:read');
  const canStock = can('inventory:read');
  const active = useProducts(canProducts ? { isActive: true, pageSize: 1 } : { pageSize: 1 });
  const drafts = useProducts({ isActive: false, pageSize: 1 });
  const low = useLowStock({ pageSize: 1 });
  const short = useDemand({ onlyShort: true, pageSize: 1 });
  const total = (meta: unknown) => (meta as { total?: number } | undefined)?.total ?? 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.name.split(' ')[0] ?? ''}`}
        description="Season overview. Order and revenue figures arrive with the Orders module."
      />

      <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Today's revenue" value="—" icon={IndianRupee} tone="muted" hint={<Soon />} />
        <Kpi label="Season revenue" value="—" icon={TrendingUp} tone="muted" hint={<Soon />} />
        <Kpi label="Pending enquiries" value="—" icon={ClipboardList} tone="muted" hint={<Soon />} />
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

      <section aria-label="Charts" className="mt-6 grid gap-3 lg:grid-cols-3">
        {['Daily sales', 'Sales by category', 'Orders by state'].map((title, i) => (
          <Card key={title} className={i === 0 ? 'lg:col-span-2' : ''}>
            <CardHeader>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>Charts appear once orders are recorded.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm">
                <BarChart3 className="size-6" aria-hidden />
                Coming with the Orders module
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </>
  );
}
