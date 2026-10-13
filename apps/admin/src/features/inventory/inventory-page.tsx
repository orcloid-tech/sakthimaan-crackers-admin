import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import type { ProductDto, StockMovementDto, StockMovementType } from '@sakthimaan/shared';
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner, TableSkeleton } from '@/components/common';
import { Can } from '@/components/guards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { dateTime, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fetchLedger, fetchMovements, keys, useDemand, useLowStock } from '../catalog/api';
import { OutOfStockChip, ProductThumb } from '../products/product-bits';
import { StockMovementDialog } from './stock-movement-dialog';

const TYPE_LABEL: Record<StockMovementType, string> = {
  stock_in: 'Stock in',
  stock_out: 'Stock out',
  adjustment: 'Count adjustment',
  order_deduct: 'Order',
  order_restock: 'Order cancelled',
};

/** Phone layout: one card per row (tables on tablet and desktop). */
function PhoneCards({ children }: { children: ReactNode }) {
  return <ul className="grid gap-2 md:hidden">{children}</ul>;
}

function DesktopTable({ children }: { children: ReactNode }) {
  return <div className="bg-card hidden overflow-x-auto rounded-xl border md:block">{children}</div>;
}

function StockFigure({ stock, low }: { stock: number; low?: boolean }) {
  return stock === 0 ? (
    <OutOfStockChip />
  ) : (
    <span className={cn('font-semibold tabular-nums', low && 'text-amber-600')}>{number(stock)}</span>
  );
}

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'low';
  const [dialog, setDialog] = useState<{ productId?: string } | null>(null);
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock is only deducted when an order is confirmed. Enquiries show as pending demand."
        actions={
          <Can allOf={['inventory:adjust']}>
            <Button onClick={() => setDialog({})}>
              <Plus /> Record stock
            </Button>
          </Can>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="mb-4 w-full sm:w-auto">
          <TabsTrigger value="low">Low stock</TabsTrigger>
          <TabsTrigger value="demand">Pending demand</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
        </TabsList>
        <TabsContent value="low">
          <LowStockTab onRestock={(productId) => setDialog({ productId })} />
        </TabsContent>
        <TabsContent value="demand">
          <DemandTab onRestock={(productId) => setDialog({ productId })} />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab />
        </TabsContent>
      </Tabs>
      {dialog ? (
        <StockMovementDialog initialProductId={dialog.productId} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

function RestockButton({ productId, onRestock }: { productId: string; onRestock: (id: string) => void }) {
  const { can } = useAuth();
  if (!can('inventory:adjust')) return null;
  return (
    <Button size="sm" variant="outline" className="h-9" onClick={() => onRestock(productId)}>
      Stock in
    </Button>
  );
}

function LowStockTab({ onRestock }: { onRestock: (productId: string) => void }) {
  const [page, setPage] = useState(1);
  // The API sorts emptiest first, so out-of-stock products are always at the top.
  const low = useLowStock({ page, pageSize: 25 });
  if (low.isPending) return <TableSkeleton />;
  if (low.isError) return <ErrorState error={low.error} onRetry={() => void low.refetch()} />;
  if (low.data.data.length === 0) {
    return (
      <EmptyState
        title="Nothing is running low"
        description="Active products at or below their alert level show up here."
      />
    );
  }
  const rows: ProductDto[] = low.data.data;
  return (
    <>
      <PhoneCards>
        {rows.map((p) => (
          <li key={p.id} className="bg-card flex items-center gap-3 rounded-xl border p-3">
            <ProductThumb product={p} size={44} />
            <Link to={`/inventory/products/${p.id}`} className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}</p>
              <p className="text-muted-foreground text-xs">
                <span className="font-mono">{p.sku}</span> · alert at {number(p.lowStockThreshold)}
                {p.pendingDemand ? ` · ${number(p.pendingDemand)} on enquiries` : ''}
              </p>
            </Link>
            <div className="grid justify-items-end gap-1.5">
              <StockFigure stock={p.stock} low />
              <RestockButton productId={p.id} onRestock={onRestock} />
            </div>
          </li>
        ))}
      </PhoneCards>
      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Alert at</TableHead>
              <TableHead className="text-right">On enquiries</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ProductThumb product={p} size={32} />
                    <div>
                      <Link to={`/inventory/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-muted-foreground font-mono text-xs">{p.sku}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <StockFigure stock={p.stock} low />
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {number(p.lowStockThreshold)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.pendingDemand ? number(p.pendingDemand) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <RestockButton productId={p.id} onRestock={onRestock} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DesktopTable>
      <Pagination
        page={page}
        pageSize={25}
        total={(low.data.meta as { total: number }).total}
        onPage={setPage}
      />
    </>
  );
}

function DemandTab({ onRestock }: { onRestock: (productId: string) => void }) {
  const [page, setPage] = useState(1);
  const [onlyShort, setOnlyShort] = useState(false);
  const demand = useDemand({ page, pageSize: 25, onlyShort });
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          variant={onlyShort ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={onlyShort}
          onClick={() => {
            setOnlyShort(!onlyShort);
            setPage(1);
          }}
        >
          Only where stock is short
        </Button>
      </div>
      {demand.isPending ? (
        <TableSkeleton />
      ) : demand.isError ? (
        <ErrorState error={demand.error} onRetry={() => void demand.refetch()} />
      ) : demand.data.data.length === 0 ? (
        <EmptyState
          title="No pending demand"
          description="Quantities on open enquiries appear here before they are confirmed."
        />
      ) : (
        <>
          <PhoneCards>
            {demand.data.data.map((d) => (
              <li key={d.productId} className="bg-card flex items-center gap-3 rounded-xl border p-3">
                <Link to={`/inventory/products/${d.productId}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.name}</p>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{d.sku}</span> · {number(d.pendingDemand)} on{' '}
                    {d.enquiryCount === 1 ? '1 enquiry' : `${d.enquiryCount} enquiries`}
                  </p>
                </Link>
                <div className="grid justify-items-end gap-1.5 text-right">
                  <StockFigure stock={d.stock} />
                  {d.shortBy > 0 ? (
                    <span className="text-destructive text-xs font-medium">Short {number(d.shortBy)}</span>
                  ) : null}
                  {d.shortBy > 0 ? <RestockButton productId={d.productId} onRestock={onRestock} /> : null}
                </div>
              </li>
            ))}
          </PhoneCards>
          <DesktopTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">On enquiries</TableHead>
                  <TableHead className="text-right">Short by</TableHead>
                  <TableHead className="text-right">Enquiries</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {demand.data.data.map((d) => (
                  <TableRow key={d.productId}>
                    <TableCell>
                      <Link to={`/inventory/products/${d.productId}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      <p className="text-muted-foreground font-mono text-xs">{d.sku}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <StockFigure stock={d.stock} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{number(d.pendingDemand)}</TableCell>
                    <TableCell className="text-right">
                      {d.shortBy > 0 ? (
                        <Badge variant="destructive">{number(d.shortBy)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.enquiryCount}</TableCell>
                    <TableCell className="text-right">
                      {d.shortBy > 0 ? <RestockButton productId={d.productId} onRestock={onRestock} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DesktopTable>
          <Pagination
            page={page}
            pageSize={25}
            total={(demand.data.meta as { total: number }).total}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}

function MovementRows({ rows, showProduct }: { rows: StockMovementDto[]; showProduct: boolean }) {
  const reference = (m: StockMovementDto) => [m.reason, m.refLabel].filter(Boolean).join(' · ') || '—';
  return (
    <>
      <PhoneCards>
        {rows.map((m) => (
          <li key={m.id} className="bg-card rounded-xl border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {showProduct ? (
                  <Link to={`/inventory/products/${m.productId}`} className="block truncate font-medium">
                    {m.product?.name ?? '—'}
                  </Link>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {dateTime(m.createdAt)} · {m.actor.name}
                </p>
              </div>
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  m.qty > 0 ? 'text-emerald-600' : 'text-destructive',
                )}
              >
                {m.qty > 0 ? `+${number(m.qty)}` : number(m.qty)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-sm">
              <Badge variant="outline">{TYPE_LABEL[m.type]}</Badge>
              <span className="tabular-nums">
                <span className="text-muted-foreground">{number(m.balanceBefore)} → </span>
                {number(m.balanceAfter)}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 truncate text-xs">{reference(m)}</p>
          </li>
        ))}
      </PhoneCards>
      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              {showProduct ? <TableHead>Product</TableHead> : null}
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Reason / reference</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-sm whitespace-nowrap">{dateTime(m.createdAt)}</TableCell>
                {showProduct ? (
                  <TableCell>
                    <Link to={`/inventory/products/${m.productId}`} className="hover:underline">
                      {m.product?.name ?? '—'}
                    </Link>
                    <p className="text-muted-foreground font-mono text-xs">{m.product?.sku}</p>
                  </TableCell>
                ) : null}
                <TableCell>
                  <Badge variant="outline">{TYPE_LABEL[m.type]}</Badge>
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium tabular-nums',
                    m.qty > 0 ? 'text-emerald-600' : 'text-destructive',
                  )}
                >
                  {m.qty > 0 ? `+${number(m.qty)}` : number(m.qty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="text-muted-foreground">{number(m.balanceBefore)} → </span>
                  {number(m.balanceAfter)}
                </TableCell>
                <TableCell className="max-w-64 truncate text-sm">{reference(m)}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{m.actor.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DesktopTable>
    </>
  );
}

function LoadMore({ show, busy, onClick }: { show: boolean; busy: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <div className="flex justify-center pt-3">
      <Button variant="outline" onClick={onClick} disabled={busy}>
        {busy ? <Spinner /> : null} Load more
      </Button>
    </div>
  );
}

function MovementsTab() {
  const [type, setType] = useState<string>('all');
  const q = useInfiniteQuery({
    queryKey: keys.movements({ type }),
    queryFn: ({ pageParam }) =>
      fetchMovements({ type: type === 'all' ? undefined : type, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Movement type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All movements</SelectItem>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.isPending ? (
        <TableSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No stock movements yet" />
      ) : (
        <>
          <MovementRows rows={rows} showProduct />
          <LoadMore show={q.hasNextPage} busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
        </>
      )}
    </>
  );
}

export function ProductLedgerPage() {
  const { id = '' } = useParams();
  const [dialog, setDialog] = useState(false);
  const q = useInfiniteQuery({
    queryKey: keys.ledger(id),
    queryFn: ({ pageParam }) => fetchLedger(id, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const product = q.data?.pages[0]?.data.product;
  const rows = q.data?.pages.flatMap((p) => p.data.movements) ?? [];
  return (
    <>
      <PageHeader
        back={
          <Link
            to="/inventory?tab=movements"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm max-lg:-ml-2 max-lg:min-h-11 max-lg:px-2"
          >
            <ArrowLeft className="size-4" aria-hidden /> Inventory
          </Link>
        }
        title={product ? `Stock ledger: ${product.name}` : 'Stock ledger'}
        description={
          product ? (
            <span className="inline-flex items-center gap-2 font-mono text-xs">
              {product.sku} · In stock {product.stock === 0 ? <OutOfStockChip /> : number(product.stock)}
            </span>
          ) : undefined
        }
        actions={
          <>
            {product ? (
              <Button variant="outline" asChild>
                <Link to={`/products/${product.id}`}>Open product</Link>
              </Button>
            ) : null}
            <Can allOf={['inventory:adjust']}>
              <Button onClick={() => setDialog(true)}>
                <Plus /> Record stock
              </Button>
            </Can>
          </>
        }
      />
      {q.isPending ? (
        <TableSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No movements yet" />
      ) : (
        <>
          <MovementRows rows={rows} showProduct={false} />
          <LoadMore show={q.hasNextPage} busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
        </>
      )}
      {dialog ? <StockMovementDialog initialProductId={id} onClose={() => setDialog(false)} /> : null}
    </>
  );
}
