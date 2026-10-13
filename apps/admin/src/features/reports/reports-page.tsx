import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import {
  INDIAN_STATES,
  REPORT_KINDS,
  type DispatchReport,
  type GstDocumentRow,
  type GstReport,
  type PaymentsReport,
  type ProductSalesReport,
  type ReportKind,
  type ReportPeriod,
  type SalesReport,
  type StateSalesReport,
  type StockReport,
} from '@sakthimaan/shared';
import { EmptyState, ErrorState, PageHeader, Section, Spinner, TableSkeleton } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { dateTime, money, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { METHOD_LABEL, OrderStatusBadge } from '../orders/order-bits';
import { istToday, rangePresets, useReport } from './api';

const TITLES: Record<ReportKind, string> = {
  sales: 'Sales',
  products: 'Products',
  states: 'States',
  gst: 'GST',
  payments: 'Payments',
  dispatch: 'Dispatch',
  stock: 'Stock',
};

const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
const day = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

// ------------------------------------------------------------------ building blocks

function Stats({ items }: { items: { label: string; value: ReactNode; tone?: 'warn' }[] }) {
  return (
    <section aria-label="Totals" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="bg-card rounded-xl border p-3">
          <p className="text-muted-foreground text-sm">{s.label}</p>
          <p
            className={cn(
              'text-xl font-semibold tabular-nums',
              s.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {s.value}
          </p>
        </div>
      ))}
    </section>
  );
}

interface Col<T> {
  header: string;
  cell: (r: T) => ReactNode;
  align?: 'right';
  /** Used as the card heading on phones. */
  primary?: boolean;
  total?: ReactNode;
}

/** Table on tablets and desktops, one card per row on phones. */
function DataList<T>({
  rows,
  cols,
  rowKey,
  empty,
}: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (r: T) => string;
  empty: string;
}) {
  if (rows.length === 0)
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">{empty}</p>
    );
  const primary = cols.find((c) => c.primary) ?? cols[0];
  const rest = cols.filter((c) => c !== primary);
  const hasTotals = cols.some((c) => c.total !== undefined);
  return (
    <>
      <ul className="grid gap-2 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="bg-card rounded-xl border p-3 text-sm">
            <div className="mb-1 font-medium">{primary?.cell(r)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {rest.map((c) => (
                <div key={c.header} className="contents">
                  <dt className="text-muted-foreground">{c.header}</dt>
                  <dd className="text-right tabular-nums">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {hasTotals ? (
          <li className="bg-muted/50 rounded-xl border p-3 text-sm font-medium">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {cols
                .filter((c) => c.total !== undefined)
                .map((c) => (
                  <div key={c.header} className="contents">
                    <dt>Total {c.header.toLowerCase()}</dt>
                    <dd className="text-right tabular-nums">{c.total}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ) : null}
      </ul>
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c.header} className={cn(c.align === 'right' && 'text-right')}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={rowKey(r)}>
                {cols.map((c) => (
                  <TableCell key={c.header} className={cn(c.align === 'right' && 'text-right tabular-nums')}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {hasTotals ? (
            <TableFooter>
              <TableRow>
                {cols.map((c, i) => (
                  <TableCell key={c.header} className={cn(c.align === 'right' && 'text-right tabular-nums')}>
                    {c.total ?? (i === 0 ? 'Total' : '')}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </>
  );
}

const OrderLink = ({ id, no }: { id: string; no: string }) => (
  <Link to={`/orders/${id}`} className="hover:text-primary font-mono underline-offset-4 hover:underline">
    {no}
  </Link>
);

// ------------------------------------------------------------------ page

/** Reports with one date range and Excel export. Periods are whole days in IST. */
export function ReportsPage() {
  const { kind } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const presets = useMemo(() => rangePresets(), []);
  const fy = presets.find((p) => p.key === 'fy');
  const from = params.get('from') ?? fy?.from ?? istToday();
  const to = params.get('to') ?? istToday();
  const [exporting, setExporting] = useState(false);

  if (!REPORT_KINDS.includes(kind as ReportKind)) return <Navigate to="/reports/sales" replace />;
  const k = kind as ReportKind;
  const preset = presets.find((p) => p.from === from && p.to === to)?.key ?? 'custom';
  const setRange = (f: string, t: string) => setParams({ from: f, to: t }, { replace: true });

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await downloadFile(`/reports/${k}`, { from, to, format: 'xlsx' }, `${k}-report.xlsx`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="All figures come from saved orders, invoices, payments and the stock ledger."
        actions={
          can('reports:export') ? (
            <Button variant="outline" onClick={() => void exportXlsx()} disabled={exporting}>
              {exporting ? <Spinner /> : <FileSpreadsheet />} Export to Excel
            </Button>
          ) : null
        }
      />
      <Tabs
        value={k}
        onValueChange={(v) => navigate({ pathname: `/reports/${v}`, search: params.toString() })}
      >
        <div className="-mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {REPORT_KINDS.map((r) => (
              <TabsTrigger key={r} value={r}>
                {TITLES[r]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select
          value={preset}
          onValueChange={(v) => {
            const p = presets.find((x) => x.key === v);
            if (p) setRange(p.from, p.to);
          }}
        >
          <SelectTrigger className="col-span-2 w-full sm:w-44" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
            {preset === 'custom' ? <SelectItem value="custom">Custom dates</SelectItem> : null}
          </SelectContent>
        </Select>
        <Input
          type="date"
          aria-label="From"
          className="min-w-0 sm:w-40"
          value={from}
          max={to}
          onChange={(e) => e.target.value && setRange(e.target.value, to)}
        />
        <Input
          type="date"
          aria-label="To"
          className="min-w-0 sm:w-40"
          value={to}
          min={from}
          onChange={(e) => e.target.value && setRange(from, e.target.value)}
        />
      </div>
      {k === 'sales' ? <SalesView range={{ from, to }} /> : null}
      {k === 'products' ? <ProductsView range={{ from, to }} /> : null}
      {k === 'states' ? <StatesView range={{ from, to }} /> : null}
      {k === 'gst' ? <GstView range={{ from, to }} /> : null}
      {k === 'payments' ? <PaymentsView range={{ from, to }} /> : null}
      {k === 'dispatch' ? <DispatchView range={{ from, to }} /> : null}
      {k === 'stock' ? <StockView range={{ from, to }} /> : null}
    </>
  );
}

type Range = { range: { from: string; to: string } };

/** Loading / error wrapper plus the period line every report shows. */
function Load<T extends { period: ReportPeriod }>({
  kind,
  range,
  children,
}: Range & { kind: ReportKind; children: (d: T) => ReactNode }) {
  const q = useReport<T>(kind, range);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <TableSkeleton rows={6} cols={4} />;
  return (
    <div className={cn(q.isFetching && 'opacity-70 transition-opacity')}>
      <p className="text-muted-foreground mb-3 text-xs">
        {day(q.data.period.from)} to {day(q.data.period.to)} · FY {q.data.period.financialYear} · generated{' '}
        {dateTime(q.data.period.generatedAt)}
      </p>
      {children(q.data)}
    </div>
  );
}

// ------------------------------------------------------------------ sales

function SalesView({ range }: Range) {
  const [all, setAll] = useState(false);
  return (
    <Load<SalesReport> kind="sales" range={range}>
      {(d) => {
        const rows = all ? d.rows : d.rows.filter((r) => r.orders > 0);
        return (
          <>
            <Stats
              items={[
                { label: 'Sales', value: money(d.totals.sales) },
                { label: 'Orders', value: number(d.totals.orders) },
                { label: 'Average order', value: money(d.totals.avgOrderValue) },
                { label: 'Days', value: number(d.totals.days) },
              ]}
            />
            <Section
              title="Daily sales"
              description="Confirmed orders (not cancelled), by the day they were confirmed. Amounts include GST."
            >
              <label className="mb-3 flex items-center gap-2 text-sm">
                <Switch checked={all} onCheckedChange={setAll} /> Show days without sales
              </label>
              <DataList
                rows={[...rows].reverse()}
                rowKey={(r) => r.date}
                empty="No confirmed orders in this period."
                cols={[
                  { header: 'Date', cell: (r) => day(r.date), primary: true },
                  {
                    header: 'Orders',
                    cell: (r) => number(r.orders),
                    align: 'right',
                    total: number(d.totals.orders),
                  },
                  {
                    header: 'Sales',
                    cell: (r) => money(r.sales),
                    align: 'right',
                    total: money(d.totals.sales),
                  },
                  {
                    header: 'Average order',
                    cell: (r) => money(r.avgOrderValue),
                    align: 'right',
                    total: money(d.totals.avgOrderValue),
                  },
                ]}
              />
            </Section>
          </>
        );
      }}
    </Load>
  );
}

// ------------------------------------------------------------------ products & categories

function ProductsView({ range }: Range) {
  return (
    <Load<ProductSalesReport> kind="products" range={range}>
      {(d) => (
        <div className="grid gap-4">
          <Stats
            items={[
              { label: 'Amount', value: money(d.totals.amount) },
              { label: 'Units sold', value: number(d.totals.qty) },
              { label: 'Products sold', value: number(d.totals.products) },
              { label: 'Categories', value: number(d.categories.length) },
            ]}
          />
          <Section title="By category">
            <DataList
              rows={d.categories}
              rowKey={(r) => r.name}
              empty="Nothing sold in this period."
              cols={[
                { header: 'Category', cell: (r) => r.name, primary: true },
                { header: 'Qty', cell: (r) => number(r.qty), align: 'right', total: number(d.totals.qty) },
                { header: 'Orders', cell: (r) => number(r.orders), align: 'right' },
                {
                  header: 'Amount',
                  cell: (r) => money(r.amount),
                  align: 'right',
                  total: money(d.totals.amount),
                },
              ]}
            />
          </Section>
          <Section title="By product" description="Highest amount first.">
            <DataList
              rows={d.products}
              rowKey={(r) => r.productId}
              empty="Nothing sold in this period."
              cols={[
                {
                  header: 'Product',
                  primary: true,
                  cell: (r) => (
                    <Link
                      to={`/products/${r.productId}`}
                      className="hover:text-primary underline-offset-4 hover:underline"
                    >
                      {r.name} <span className="text-muted-foreground font-mono text-xs">{r.sku}</span>
                    </Link>
                  ),
                },
                { header: 'Category', cell: (r) => r.category },
                { header: 'Qty', cell: (r) => number(r.qty), align: 'right', total: number(d.totals.qty) },
                { header: 'Orders', cell: (r) => number(r.orders), align: 'right' },
                {
                  header: 'Amount',
                  cell: (r) => money(r.amount),
                  align: 'right',
                  total: money(d.totals.amount),
                },
              ]}
            />
          </Section>
        </div>
      )}
    </Load>
  );
}

// ------------------------------------------------------------------ states

function StatesView({ range }: Range) {
  return (
    <Load<StateSalesReport> kind="states" range={range}>
      {(d) => (
        <>
          <Stats
            items={[
              { label: 'Sales', value: money(d.totals.sales) },
              { label: 'Orders', value: number(d.totals.orders) },
              { label: 'States', value: number(d.totals.states) },
            ]}
          />
          <Section title="Orders and sales by delivery state">
            <DataList
              rows={d.rows}
              rowKey={(r) => r.stateCode}
              empty="No confirmed orders in this period."
              cols={[
                { header: 'State', cell: (r) => r.stateName, primary: true },
                {
                  header: 'Orders',
                  cell: (r) => number(r.orders),
                  align: 'right',
                  total: number(d.totals.orders),
                },
                {
                  header: 'Sales',
                  cell: (r) => money(r.sales),
                  align: 'right',
                  total: money(d.totals.sales),
                },
                { header: 'Average order', cell: (r) => money(r.avgOrderValue), align: 'right' },
              ]}
            />
          </Section>
        </>
      )}
    </Load>
  );
}

// ------------------------------------------------------------------ GST

function GstView({ range }: Range) {
  return (
    <Load<GstReport> kind="gst" range={range}>
      {(d) => {
        const n = d.totals.net;
        type Tax = { taxableValue: number; cgst: number; sgst: number; igst: number };
        const taxCols = <T extends Tax>(totals?: Tax): Col<T>[] => [
          {
            header: 'Taxable',
            cell: (r) => money(r.taxableValue),
            align: 'right',
            total: totals ? money(totals.taxableValue) : undefined,
          },
          {
            header: 'CGST',
            cell: (r) => money(r.cgst),
            align: 'right',
            total: totals ? money(totals.cgst) : undefined,
          },
          {
            header: 'SGST',
            cell: (r) => money(r.sgst),
            align: 'right',
            total: totals ? money(totals.sgst) : undefined,
          },
          {
            header: 'IGST',
            cell: (r) => money(r.igst),
            align: 'right',
            total: totals ? money(totals.igst) : undefined,
          },
        ];
        return (
          <div className="grid gap-4">
            {!d.sellerGstin ? (
              <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-4" aria-hidden /> Your GSTIN is not set.{' '}
                <Link to="/settings" className="underline underline-offset-4">
                  Add it in Settings
                </Link>
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Seller GSTIN <span className="font-mono">{d.sellerGstin}</span>. Export to Excel for the
                GSTR-1 tables (B2B, B2CL, B2CS, credit notes, HSN, documents).
              </p>
            )}
            <Stats
              items={[
                { label: 'Taxable value (net)', value: money(n.taxableValue) },
                { label: 'CGST + SGST (net)', value: money(n.cgst + n.sgst) },
                { label: 'IGST (net)', value: money(n.igst) },
                {
                  label: 'Invoices / credit notes',
                  value: `${number(d.totals.invoices.count)} / ${number(d.totals.creditNotes.count)}`,
                },
              ]}
            />
            <Section title="Rate-wise summary" description="Invoices less credit notes.">
              <DataList
                rows={d.rates}
                rowKey={(r) => String(r.taxRate)}
                empty="No GST documents in this period."
                cols={[
                  { header: 'GST rate', cell: (r) => `${r.taxRate}%`, primary: true },
                  ...taxCols<GstReport['rates'][number]>(n),
                ]}
              />
            </Section>
            <Section title="HSN summary" description="Invoices less credit notes, as in GSTR-1 table 12.">
              <DataList
                rows={d.hsn}
                rowKey={(r) => `${r.hsn}|${r.taxRate}`}
                empty="No GST documents in this period."
                cols={[
                  { header: 'HSN', cell: (r) => `${r.hsn} · ${r.taxRate}%`, primary: true },
                  { header: 'Qty', cell: (r) => `${number(r.qty)} ${r.uqc}`, align: 'right' },
                  ...taxCols<GstReport['hsn'][number]>(n),
                ]}
              />
            </Section>
            <Section title="Invoices">
              <DataList
                rows={d.invoices}
                rowKey={(r) => r.id}
                empty="No invoices issued in this period."
                cols={[
                  {
                    header: 'Invoice',
                    cell: (r) => <OrderLink id={r.orderId} no={r.number} />,
                    primary: true,
                  },
                  { header: 'Date', cell: (r) => day(r.date) },
                  {
                    header: 'Buyer',
                    cell: (r) => (
                      <>
                        {r.buyerName}
                        {r.buyerGstin ? (
                          <span className="text-muted-foreground block font-mono text-xs">
                            {r.buyerGstin}
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                  { header: 'Supply to', cell: (r) => stateName(r.placeOfSupply) },
                  ...taxCols<GstDocumentRow>(d.totals.invoices),
                  {
                    header: 'Total',
                    cell: (r) => money(r.total),
                    align: 'right',
                    total: money(d.totals.invoices.total),
                  },
                ]}
              />
            </Section>
            <Section title="Credit notes">
              <DataList
                rows={d.creditNotes}
                rowKey={(r) => r.id}
                empty="No credit notes in this period."
                cols={[
                  {
                    header: 'Credit note',
                    cell: (r) => <OrderLink id={r.orderId} no={r.number} />,
                    primary: true,
                  },
                  { header: 'Date', cell: (r) => day(r.date) },
                  { header: 'Against', cell: (r) => <span className="font-mono">{r.invoiceNumber}</span> },
                  { header: 'Buyer', cell: (r) => r.buyerName },
                  ...taxCols<GstDocumentRow>(d.totals.creditNotes),
                  {
                    header: 'Total',
                    cell: (r) => money(r.total),
                    align: 'right',
                    total: money(d.totals.creditNotes.total),
                  },
                ]}
              />
            </Section>
          </div>
        );
      }}
    </Load>
  );
}

// ------------------------------------------------------------------ payments

function PaymentsView({ range }: Range) {
  return (
    <Load<PaymentsReport> kind="payments" range={range}>
      {(d) => (
        <div className="grid gap-4">
          <Stats
            items={[
              { label: 'Received', value: money(d.totals.received) },
              { label: 'Refunded', value: money(d.totals.refunded) },
              { label: 'Net collected', value: money(d.totals.net) },
              {
                label: 'Outstanding now',
                value: money(d.totals.outstanding),
                tone: d.totals.outstanding > 0 ? 'warn' : undefined,
              },
            ]}
          />
          <Section title="By payment method">
            <DataList
              rows={d.byMethod}
              rowKey={(r) => r.method}
              empty="No payments recorded in this period."
              cols={[
                { header: 'Method', cell: (r) => METHOD_LABEL[r.method], primary: true },
                { header: 'Payments', cell: (r) => number(r.payments), align: 'right' },
                {
                  header: 'Received',
                  cell: (r) => money(r.received),
                  align: 'right',
                  total: money(d.totals.received),
                },
                {
                  header: 'Refunded',
                  cell: (r) => money(r.refunded),
                  align: 'right',
                  total: money(d.totals.refunded),
                },
                { header: 'Net', cell: (r) => money(r.net), align: 'right', total: money(d.totals.net) },
              ]}
            />
          </Section>
          <Section
            title="Outstanding"
            description="As of now: confirmed orders with money still due (not limited to the period)."
          >
            <DataList
              rows={d.outstanding}
              rowKey={(r) => r.orderId}
              empty="Nothing outstanding."
              cols={[
                { header: 'Order', cell: (r) => <OrderLink id={r.orderId} no={r.orderNo} />, primary: true },
                {
                  header: 'Customer',
                  cell: (r) => (
                    <>
                      {r.customer}
                      <span className="text-muted-foreground block text-xs">{r.phone}</span>
                    </>
                  ),
                },
                { header: 'Status', cell: (r) => <OrderStatusBadge status={r.status} /> },
                { header: 'Total', cell: (r) => money(r.total), align: 'right' },
                { header: 'Paid', cell: (r) => money(r.paid), align: 'right' },
                {
                  header: 'Due',
                  cell: (r) => money(r.due),
                  align: 'right',
                  total: money(d.totals.outstanding),
                },
              ]}
            />
          </Section>
          <Section title="Payments in the period">
            <DataList
              rows={d.payments}
              rowKey={(r) => r.id}
              empty="No payments recorded in this period."
              cols={[
                { header: 'Order', cell: (r) => <OrderLink id={r.orderId} no={r.orderNo} />, primary: true },
                { header: 'Paid on', cell: (r) => dateTime(r.paidAt) },
                { header: 'Customer', cell: (r) => r.customer },
                {
                  header: 'Method',
                  cell: (r) => (
                    <>
                      {METHOD_LABEL[r.method]}
                      {r.kind === 'refund' ? (
                        <Badge variant="outline" className="ml-1">
                          Refund
                        </Badge>
                      ) : null}
                    </>
                  ),
                },
                {
                  header: 'Reference',
                  cell: (r) => <span className="font-mono text-xs">{r.reference ?? '—'}</span>,
                },
                {
                  header: 'Amount',
                  cell: (r) => `${r.kind === 'refund' ? '− ' : ''}${money(r.amount)}`,
                  align: 'right',
                },
              ]}
            />
          </Section>
          <Section
            title="Voided payments"
            description="Payments cancelled in the period, with the reason given."
          >
            <DataList
              rows={d.voided}
              rowKey={(r) => r.id}
              empty="No payments were voided in this period."
              cols={[
                { header: 'Order', cell: (r) => <OrderLink id={r.orderId} no={r.orderNo} />, primary: true },
                { header: 'Voided', cell: (r) => (r.voidedAt ? dateTime(r.voidedAt) : '—') },
                { header: 'Method', cell: (r) => METHOD_LABEL[r.method] },
                { header: 'Reason', cell: (r) => r.reason ?? '—' },
                { header: 'By', cell: (r) => r.voidedBy ?? '—' },
                {
                  header: 'Amount',
                  cell: (r) => money(r.amount),
                  align: 'right',
                  total: money(d.totals.voided),
                },
              ]}
            />
          </Section>
        </div>
      )}
    </Load>
  );
}

// ------------------------------------------------------------------ dispatch

function DispatchView({ range }: Range) {
  return (
    <Load<DispatchReport> kind="dispatch" range={range}>
      {(d) => (
        <div className="grid gap-4">
          <Stats
            items={[
              { label: 'Consignments', value: number(d.totals.orders) },
              { label: 'Boxes', value: number(d.totals.boxes) },
              { label: 'Transports used', value: number(d.byPartner.length) },
            ]}
          />
          <Section title="By transport">
            <DataList
              rows={d.byPartner}
              rowKey={(r) => r.transportName}
              empty="Nothing dispatched in this period."
              cols={[
                { header: 'Transport', cell: (r) => r.transportName || '—', primary: true },
                {
                  header: 'Orders',
                  cell: (r) => number(r.orders),
                  align: 'right',
                  total: number(d.totals.orders),
                },
                {
                  header: 'Boxes',
                  cell: (r) => number(r.boxes),
                  align: 'right',
                  total: number(d.totals.boxes),
                },
              ]}
            />
          </Section>
          <Section title="Consignments">
            <DataList
              rows={d.rows}
              rowKey={(r) => r.orderId}
              empty="Nothing dispatched in this period."
              cols={[
                { header: 'Order', cell: (r) => <OrderLink id={r.orderId} no={r.orderNo} />, primary: true },
                { header: 'Dispatched', cell: (r) => (r.dispatchDate ? day(r.dispatchDate) : '—') },
                {
                  header: 'Customer',
                  cell: (r) => (
                    <>
                      {r.customer}
                      <span className="text-muted-foreground block text-xs">
                        {r.city}, {r.stateCode}
                      </span>
                    </>
                  ),
                },
                { header: 'Transport', cell: (r) => r.transportName },
                { header: 'LR number', cell: (r) => <span className="font-mono">{r.lrNumber}</span> },
                {
                  header: 'Boxes',
                  cell: (r) => number(r.boxes),
                  align: 'right',
                  total: number(d.totals.boxes),
                },
              ]}
            />
          </Section>
        </div>
      )}
    </Load>
  );
}

// ------------------------------------------------------------------ stock

function StockView({ range }: Range) {
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  return (
    <Load<StockReport> kind="stock" range={range}>
      {(d) => {
        const rows = d.rows.filter(
          (r) =>
            (!lowOnly || r.isLow || r.stock === 0) &&
            (!q || `${r.name} ${r.sku} ${r.category}`.toLowerCase().includes(q.toLowerCase())),
        );
        const moved = (r: StockReport['rows'][number]) =>
          Object.values(r.movements).reduce((s, v) => s + v, 0);
        return (
          <div className="grid gap-4">
            <Stats
              items={[
                { label: 'Stock value (net price)', value: money(d.totals.value) },
                { label: 'Units in stock', value: number(d.totals.units) },
                { label: 'Received in period', value: number(d.totals.movedIn) },
                { label: 'Out in period', value: number(d.totals.movedOut) },
              ]}
            />
            <Section
              title="Products"
              description="Stock and value as of now; movements are for the selected period."
            >
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Input
                  aria-label="Filter products"
                  placeholder="Filter by name, SKU or category"
                  className="sm:w-72"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={lowOnly} onCheckedChange={setLowOnly} /> Low or out of stock only
                </label>
              </div>
              {d.rows.length === 0 ? (
                <EmptyState title="No products yet" />
              ) : (
                <DataList
                  rows={rows}
                  rowKey={(r) => r.productId}
                  empty="No products match."
                  cols={[
                    {
                      header: 'Product',
                      primary: true,
                      cell: (r) => (
                        <Link
                          to={`/inventory/products/${r.productId}`}
                          className="hover:text-primary underline-offset-4 hover:underline"
                        >
                          {r.name} <span className="text-muted-foreground font-mono text-xs">{r.sku}</span>
                          {!r.isActive ? (
                            <Badge variant="secondary" className="ml-1">
                              Draft
                            </Badge>
                          ) : null}
                        </Link>
                      ),
                    },
                    {
                      header: 'Stock',
                      align: 'right',
                      cell: (r) => (
                        <span
                          className={cn(
                            (r.isLow || r.stock === 0) && 'font-medium text-amber-700 dark:text-amber-400',
                          )}
                        >
                          {number(r.stock)}
                        </span>
                      ),
                      total: number(d.totals.units),
                    },
                    { header: 'Net price', cell: (r) => money(r.netPrice), align: 'right' },
                    {
                      header: 'Value',
                      cell: (r) => money(r.value),
                      align: 'right',
                      total: money(d.totals.value),
                    },
                    {
                      header: 'In',
                      cell: (r) => number(r.movements.stock_in + r.movements.order_restock),
                      align: 'right',
                    },
                    { header: 'Sold', cell: (r) => number(-r.movements.order_deduct), align: 'right' },
                    {
                      header: 'Net change',
                      cell: (r) => {
                        const m = moved(r);
                        return `${m > 0 ? '+' : ''}${number(m)}`;
                      },
                      align: 'right',
                    },
                  ]}
                />
              )}
            </Section>
          </div>
        );
      }}
    </Load>
  );
}
