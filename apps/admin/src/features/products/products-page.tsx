import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import {
  ArrowDownUp,
  Download,
  FileDown,
  FileUp,
  Gift,
  MoreHorizontal,
  Percent,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDto } from '@sakthimaan/shared';
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '@/components/common';
import { Can } from '@/components/guards';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { FilterBar } from '@/components/responsive';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useDebounced } from '@/hooks/use-debounced';
import { errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useCategoryTree, useProductMutations, useProducts } from '../catalog/api';
import { BulkPriceDialog } from './bulk-price-dialog';
import { PriceListDialog } from './price-list-dialog';
import { GreenBadge, PriceCell, ProductThumb, StatusBadge, StockCell } from './product-bits';

const SORTS = {
  sortOrder: 'Display order',
  name: 'Name',
  netPrice: 'Net price',
  stock: 'Stock',
  updatedAt: 'Last updated',
} as const;

/** Products and gift boxes share this page (`kind`). Filters live in the URL. */
export function ProductsPage({ kind }: { kind: 'single' | 'combo' }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const categories = useCategoryTree();
  const m = useProductMutations();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [priceListOpen, setPriceListOpen] = useState(false);

  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);
  const page = Number(params.get('page') ?? '1') || 1;
  const categoryId = params.get('category') ?? '';
  const status = params.get('status') ?? 'all';
  const sort = (params.get('sort') ?? 'sortOrder') as keyof typeof SORTS;
  const order = params.get('order') === 'desc' ? 'desc' : 'asc';
  const lowStock = params.get('low') === '1';
  const deleted = params.get('deleted') === '1';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '' || value === 'all') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const query = {
    q: q || undefined,
    type: kind,
    categoryId: categoryId || undefined,
    isActive: status === 'active' ? true : status === 'draft' ? false : undefined,
    lowStock: lowStock || undefined,
    deleted: deleted || undefined,
    sort,
    order,
    page,
    pageSize: 25,
  };
  const list = useProducts(query);
  const detailPath = (p: ProductDto) => (p.type === 'combo' ? `/gift-boxes/${p.id}` : `/products/${p.id}`);

  const columns: ColumnDef<ProductDto>[] = [
    {
      id: 'product',
      header: kind === 'combo' ? 'Gift box' : 'Product',
      cell: ({ row: { original: p } }) => (
        <div className="flex min-w-56 items-center gap-3">
          <ProductThumb product={p} />
          <div className="min-w-0">
            <Link
              to={detailPath(p)}
              className="hover:text-primary block truncate font-medium underline-offset-4 hover:underline"
            >
              {p.name}
            </Link>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
              <span className="font-mono">{p.sku}</span>
              <span>{p.subCategory ? `${p.category?.name} › ${p.subCategory.name}` : p.category?.name}</span>
              {p.isGreen ? <GreenBadge /> : null}
              {p.type === 'combo' ? <span>{p.comboItems.length} items</span> : null}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'content',
      header: 'Pack',
      cell: ({ row: { original: p } }) => (
        <span className="text-sm whitespace-nowrap">
          {p.contentsCount} pcs / {p.unit}
        </span>
      ),
    },
    {
      id: 'price',
      header: () => <div className="text-right">Price</div>,
      cell: ({ row }) => <PriceCell product={row.original} />,
    },
    {
      id: 'stock',
      header: () => <div className="text-right">Stock</div>,
      cell: ({ row }) => <StockCell product={row.original} />,
    },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge product={row.original} /> },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: p } }) =>
        p.isDeleted && can('products:delete') ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              toast.promise(m.restore.mutateAsync(p.id), {
                loading: 'Restoring…',
                success: `${p.name} restored`,
                error: (err: unknown) => errorMessage(err),
              })
            }
          >
            <RotateCcw /> Restore
          </Button>
        ) : null,
    },
  ];

  const table = useReactTable({
    data: list.data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const exportFile = (format: 'csv' | 'xlsx') =>
    toast.promise(
      downloadFile('/products/export', { format, categoryId: categoryId || undefined }, `products.${format}`),
      {
        loading: 'Preparing export…',
        success: 'Export downloaded',
        error: (err: unknown) => errorMessage(err),
      },
    );

  const title = kind === 'combo' ? 'Gift boxes' : 'Products';
  return (
    <>
      <PageHeader
        title={title}
        description={
          kind === 'combo'
            ? 'Factory-packed gift boxes with their own stock and price.'
            : 'Prices include GST. Net price = MRP less discount.'
        }
        actions={
          <>
            <Can allOf={['products:create']}>
              <Button onClick={() => navigate(kind === 'combo' ? '/gift-boxes/new' : '/products/new')}>
                <Plus /> {kind === 'combo' ? 'New gift box' : 'New product'}
              </Button>
            </Can>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {can('products:update_price') ? (
                  <DropdownMenuItem onSelect={() => setBulkOpen(true)}>
                    <Percent className="size-4" aria-hidden /> Bulk price change
                  </DropdownMenuItem>
                ) : null}
                {kind === 'single' && can('products:create') ? (
                  <DropdownMenuItem onSelect={() => navigate('/gift-boxes/new')}>
                    <Gift className="size-4" aria-hidden /> Build a gift box
                  </DropdownMenuItem>
                ) : null}
                {can('products:import') ? (
                  <DropdownMenuItem onSelect={() => navigate('/products/import')}>
                    <FileUp className="size-4" aria-hidden /> Import from Excel / CSV
                  </DropdownMenuItem>
                ) : null}
                {can('products:export') ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-muted-foreground text-xs">Download</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setPriceListOpen(true)}>
                      <FileDown className="size-4" aria-hidden /> Price list (PDF)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportFile('xlsx')}>
                      <Download className="size-4" aria-hidden /> Export Excel
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportFile('csv')}>
                      <Download className="size-4" aria-hidden /> Export CSV
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <FilterBar
        className="md:grid md:grid-cols-2 lg:grid-cols-[1fr_12rem_9rem_11rem_auto]"
        active={(categoryId ? 1 : 0) + (status !== 'all' || deleted ? 1 : 0) + (lowStock ? 1 : 0)}
        onClear={() => {
          const next = new URLSearchParams();
          for (const k of ['q', 'sort', 'order']) {
            const v = params.get(k);
            if (v) next.set(k, v);
          }
          setParams(next, { replace: true });
        }}
        search={
          <div className="relative">
            <Search
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam('q', e.target.value.trim());
              }}
              placeholder="Search name, SKU or tag"
              aria-label="Search products"
              className="pl-8"
              enterKeyHint="search"
            />
          </div>
        }
      >
        <Select value={categoryId || 'all'} onValueChange={(v) => setParam('category', v)}>
          <SelectTrigger className="w-full" aria-label="Category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.data?.flatMap((c) => [
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>,
              ...c.children.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {'  '}› {s.name}
                </SelectItem>
              )),
            ])}
          </SelectContent>
        </Select>
        <Select
          value={deleted ? 'deleted' : status}
          onValueChange={(v) => {
            const next = new URLSearchParams(params);
            next.delete('page');
            next.delete('status');
            next.delete('deleted');
            if (v === 'deleted') next.set('deleted', '1');
            else if (v !== 'all') next.set('status', v);
            setParams(next, { replace: true });
          }}
        >
          <SelectTrigger className="w-full" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            {can('products:delete') ? <SelectItem value="deleted">Deleted</SelectItem> : null}
          </SelectContent>
        </Select>
        <Select
          value={`${sort}:${order}`}
          onValueChange={(v) => {
            const [s, o] = v.split(':');
            const next = new URLSearchParams(params);
            next.set('sort', s ?? 'sortOrder');
            next.set('order', o ?? 'asc');
            next.delete('page');
            setParams(next, { replace: true });
          }}
        >
          <SelectTrigger className="w-full" aria-label="Sort by">
            <ArrowDownUp className="size-4" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORTS).flatMap(([key, label]) => [
              <SelectItem key={`${key}:asc`} value={`${key}:asc`}>
                {label} ↑
              </SelectItem>,
              <SelectItem key={`${key}:desc`} value={`${key}:desc`}>
                {label} ↓
              </SelectItem>,
            ])}
          </SelectContent>
        </Select>
        <Button
          variant={lowStock ? 'secondary' : 'outline'}
          aria-pressed={lowStock}
          onClick={() => setParam('low', lowStock ? null : '1')}
        >
          Low stock
        </Button>
      </FilterBar>

      {list.isPending ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          title={
            q || categoryId || status !== 'all' || lowStock ? 'No matches' : `No ${title.toLowerCase()} yet`
          }
          description={q || categoryId || status !== 'all' || lowStock ? 'Try different filters.' : undefined}
        />
      ) : (
        <>
          {/* Phones: one card per product (staff use phones during the season). */}
          <ul className={`grid gap-2 md:hidden ${list.isFetching ? 'opacity-70' : ''}`}>
            {list.data.data.map((p) => (
              <li key={p.id}>
                <Link
                  to={detailPath(p)}
                  className="bg-card focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl border p-3 outline-none focus-visible:ring-2"
                >
                  <ProductThumb product={p} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="font-mono">{p.sku}</span>
                      {p.isGreen ? <GreenBadge /> : null}
                    </p>
                    <div className="mt-1">
                      <StatusBadge product={p} />
                    </div>
                  </div>
                  <div className="grid justify-items-end gap-1">
                    <PriceCell product={p} />
                    <StockCell product={p} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div
            className={`bg-card hidden overflow-x-auto rounded-xl border md:block ${list.isFetching ? 'opacity-70' : ''}`}
          >
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={25}
            total={(list.data.meta as { total: number } | undefined)?.total ?? 0}
            onPage={(p) => setParam('page', String(p))}
          />
        </>
      )}

      {bulkOpen ? (
        <BulkPriceDialog onClose={() => setBulkOpen(false)} defaultCategoryId={categoryId || undefined} />
      ) : null}
      {priceListOpen ? <PriceListDialog onClose={() => setPriceListOpen(false)} /> : null}
    </>
  );
}
