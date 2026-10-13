import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  CreditCard,
  FileText,
  MessageCircle,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  Receipt,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ORDER_TRANSITIONS,
  transitionRequirements,
  type OrderActivityDto,
  type OrderDto,
  type OrderStatus,
  type PaymentDto,
  type ShortageItem,
  type WhatsAppEvent,
} from '@sakthimaan/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState, PageHeader, Section, Spinner, TableSkeleton } from '@/components/common';
import { StickyActions } from '@/components/responsive';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage } from '@/lib/api';
import { openPdf } from '@/lib/download';
import { dateTime, money, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOrder, useOrderMutations, whatsappLink } from './api';
import {
  CancelOrderDialog,
  DispatchDialog,
  PaymentDialog,
  ShortageDialog,
  VoidPaymentDialog,
} from './order-dialogs';
import { DeliveryDetailsDialog } from './delivery-dialog';
import { PreviewPanel } from './order-form-page';
import {
  LineEditor,
  METHOD_LABEL,
  OrderStatusBadge,
  PaymentBadge,
  STATUS_LABEL,
  TotalsBlock,
  stateName,
  type DraftLine,
} from './order-bits';

type DialogState =
  | { kind: 'payment' }
  | { kind: 'void'; payment: PaymentDto }
  | { kind: 'dispatch'; andMark: boolean }
  | { kind: 'cancel' }
  | { kind: 'shortage'; items: ShortageItem[] }
  | { kind: 'packCredit' }
  | { kind: 'delivery' }
  | null;

const WA_EVENTS: { event: WhatsAppEvent; label: string; when: (o: OrderDto) => boolean }[] = [
  { event: 'order_received', label: 'Enquiry received', when: (o) => o.status === 'enquiry' },
  {
    event: 'order_confirmed',
    label: 'Confirmed, with payment details',
    when: (o) => o.status === 'confirmed',
  },
  {
    event: 'payment_reminder',
    label: 'Payment reminder',
    when: (o) => o.status !== 'cancelled' && o.status !== 'enquiry' && o.balanceDue > 0,
  },
  { event: 'payment_received', label: 'Payment received', when: (o) => o.amountPaid > 0 },
  { event: 'order_packed', label: 'Packed', when: (o) => o.status === 'packed' },
  { event: 'order_dispatched', label: 'Dispatched, with LR number', when: (o) => !!o.dispatch.lrNumber },
  { event: 'order_delivered', label: 'Delivered', when: (o) => o.status === 'delivered' },
  { event: 'order_cancelled', label: 'Cancelled', when: (o) => o.status === 'cancelled' },
];

const SUGGESTED: Partial<Record<OrderStatus, WhatsAppEvent>> = {
  enquiry: 'order_received',
  confirmed: 'order_confirmed',
  payment_received: 'payment_received',
  packed: 'order_packed',
  dispatched: 'order_dispatched',
  delivered: 'order_delivered',
  cancelled: 'order_cancelled',
};

/** Opens WhatsApp with a prefilled message (staff press send). The tab opens first so pop-up blockers allow it. */
async function openWhatsApp(orderId: string, event: WhatsAppEvent) {
  const tab = window.open('', '_blank');
  try {
    const { url, warnings } = await whatsappLink(orderId, event);
    for (const w of warnings) toast.warning(w);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (err) {
    tab?.close();
    toast.error(errorMessage(err));
  }
}

function pdf(path: string, name: string) {
  openPdf(path, undefined, name).catch((err: unknown) => toast.error(errorMessage(err)));
}

// ------------------------------------------------------------------ page

export function OrderDetailPage() {
  const { id } = useParams();
  const order = useOrder(id);
  const { can } = useAuth();
  const m = useOrderMutations(id);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [editing, setEditing] = useState<DraftLine[] | null>(null);

  if (order.isError) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  if (order.isPending) return <TableSkeleton rows={8} cols={3} />;
  const o = order.data;
  const close = () => setDialog(null);

  const move = async (to: OrderStatus, okText: string) => {
    try {
      await m.transition.mutateAsync({ to, version: o.version });
      toast.success(okText);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') {
        const items = (err.details as { items?: ShortageItem[] } | undefined)?.items ?? [];
        setDialog({ kind: 'shortage', items });
      } else if (err instanceof ApiError && err.code === 'DISPATCH_DETAILS_REQUIRED') {
        setDialog({ kind: 'dispatch', andMark: true });
      } else toast.error(errorMessage(err));
      throw err;
    }
  };
  const allowed = (to: OrderStatus) => {
    const req = transitionRequirements(o.status, to);
    return !!req && can(...req.permissions);
  };
  const next = ORDER_TRANSITIONS[o.status];
  const busy = m.transition.isPending;

  // Primary workflow actions, in the order staff use them.
  const actions: ReactNode[] = [];
  if (next.includes('confirmed') && allowed('confirmed')) {
    actions.push(
      <Button
        key="confirm"
        disabled={busy || !!editing}
        onClick={() => void move('confirmed', 'Order confirmed, stock reserved').catch(() => undefined)}
      >
        {busy ? <Spinner /> : <CheckCircle2 />} Confirm order
      </Button>,
    );
  }
  if (o.status !== 'enquiry' && o.status !== 'cancelled' && can('payments:record')) {
    actions.push(
      <Button
        key="pay"
        variant={o.balanceDue > 0 && o.status === 'confirmed' ? 'default' : 'outline'}
        onClick={() => setDialog({ kind: 'payment' })}
      >
        <CreditCard /> Record payment
      </Button>,
    );
  }
  if (next.includes('packed')) {
    if (o.status === 'payment_received' && allowed('packed')) {
      actions.push(
        <Button
          key="pack"
          disabled={busy}
          onClick={() => void move('packed', 'Marked packed').catch(() => undefined)}
        >
          <PackageCheck /> Mark packed
        </Button>,
      );
    } else if (o.status === 'confirmed' && allowed('packed') && o.customer.creditAllowed) {
      actions.push(
        <Button
          key="pack-credit"
          variant="outline"
          disabled={busy}
          onClick={() => setDialog({ kind: 'packCredit' })}
        >
          <PackageCheck /> Pack on credit
        </Button>,
      );
    }
  }
  if (next.includes('dispatched') && allowed('dispatched')) {
    actions.push(
      <Button
        key="dispatch"
        disabled={busy}
        onClick={() =>
          o.dispatch.lrNumber
            ? void move('dispatched', 'Marked dispatched').catch(() => undefined)
            : setDialog({ kind: 'dispatch', andMark: true })
        }
      >
        <Truck /> Mark dispatched
      </Button>,
    );
  }
  if (next.includes('delivered') && allowed('delivered')) {
    actions.push(
      <Button
        key="delivered"
        disabled={busy}
        onClick={() => void move('delivered', 'Marked delivered').catch(() => undefined)}
      >
        <CheckCircle2 /> Mark delivered
      </Button>,
    );
  }

  const canInvoice =
    can('orders:invoice') &&
    !o.invoice &&
    ['confirmed', 'payment_received', 'packed', 'dispatched', 'delivered'].includes(o.status);
  const canEditLines = o.status === 'enquiry' && can('orders:update');
  const waSuggested = SUGGESTED[o.status];
  const fileBase = o.orderNo.replace(/\//g, '-');

  return (
    <>
      <PageHeader
        title={o.orderNo}
        back={
          <Link
            to="/orders"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm max-lg:-ml-2 max-lg:min-h-11 max-lg:px-2"
          >
            <ChevronLeft className="size-4" aria-hidden /> Orders
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <OrderStatusBadge status={o.status} />
            <PaymentBadge status={o.paymentStatus} />
            {o.packedOnCredit ? <Badge variant="outline">Packed on credit</Badge> : null}
            <span>
              {o.source === 'storefront' ? 'Website' : o.source === 'whatsapp' ? 'WhatsApp' : 'Phone'} ·{' '}
              {dateTime(o.createdAt)}
            </span>
          </span>
        }
        actions={
          <>
            {/* Phones: workflow buttons live in the sticky bar at the bottom instead. */}
            <span className="hidden md:contents">{actions}</span>
            <WhatsAppMenu order={o} suggested={waSuggested} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <FileText /> Documents <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canInvoice ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      toast.promise(m.invoice.mutateAsync(), {
                        loading: 'Issuing invoice…',
                        success: (r) => `Invoice ${r.invoice?.number ?? ''} issued`,
                        error: (err: unknown) => errorMessage(err),
                      })
                    }
                  >
                    <Receipt /> Issue GST invoice
                  </DropdownMenuItem>
                ) : null}
                {o.invoice ? (
                  <DropdownMenuItem
                    onSelect={() => pdf(`/orders/${o.id}/invoice.pdf`, `${fileBase}-invoice.pdf`)}
                  >
                    <Receipt /> Invoice {o.invoice.number}
                  </DropdownMenuItem>
                ) : null}
                {o.status !== 'enquiry' && o.status !== 'cancelled' ? (
                  <DropdownMenuItem
                    onSelect={() => pdf(`/orders/${o.id}/packing-slip.pdf`, `${fileBase}-packing.pdf`)}
                  >
                    <Package /> Packing slip
                  </DropdownMenuItem>
                ) : null}
                {o.creditNotes.map((cn) => (
                  <DropdownMenuItem
                    key={cn.id}
                    onSelect={() =>
                      pdf(`/orders/credit-notes/${cn.id}/pdf`, `${cn.number.replace(/\//g, '-')}.pdf`)
                    }
                  >
                    <FileText /> Credit note {cn.number}
                  </DropdownMenuItem>
                ))}
                {!canInvoice &&
                !o.invoice &&
                o.creditNotes.length === 0 &&
                (o.status === 'enquiry' || o.status === 'cancelled') ? (
                  <DropdownMenuLabel className="text-muted-foreground font-normal">
                    Documents are available once confirmed.
                  </DropdownMenuLabel>
                ) : null}
                {next.includes('cancelled') && allowed('cancelled') ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'cancel' })}>
                      <Ban /> Cancel order
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {o.status === 'cancelled' && o.cancelReason ? (
        <p className="border-destructive/30 bg-destructive/5 text-destructive mb-4 rounded-lg border px-3 py-2 text-sm">
          Cancelled {dateTime(o.cancelledAt)}: {o.cancelReason}
        </p>
      ) : null}

      {/* Phones and tablets: who, where and how much before the item list (the cards are further down). */}
      <section
        aria-label="Summary"
        className="bg-card mb-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border p-3 text-sm lg:hidden"
      >
        <div className="col-span-2 flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate font-medium">{o.customer.name}</p>
          <a
            href={`tel:${o.customer.phone}`}
            data-slot="tel-link"
            className="text-primary inline-flex min-h-11 shrink-0 items-center font-mono text-sm"
          >
            {o.customer.phone}
          </a>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">Ship to</p>
          <p className="truncate">
            {o.shippingAddress.city}, {stateName(o.shippingAddress.stateCode)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground text-xs">
            {o.balanceDue > 0 && o.status !== 'enquiry' ? 'Due' : 'Total'}
          </p>
          <p className="font-semibold tabular-nums">
            {money(o.balanceDue > 0 && o.status !== 'enquiry' ? o.balanceDue : o.pricing.grandTotal)}
          </p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="grid min-w-0 gap-4">
          {editing ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_18rem] xl:items-start">
              <Section title="Edit items" description="Prices are re-read from the catalogue when you save.">
                <LineEditor lines={editing} onChange={setEditing} />
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditing(null)}>
                    Discard
                  </Button>
                  <Button
                    disabled={m.update.isPending || editing.length === 0}
                    onClick={() =>
                      void m.update
                        .mutateAsync({
                          version: o.version,
                          items: editing.map((l) => ({ productId: l.productId, qty: l.qty })),
                        })
                        .then(() => {
                          setEditing(null);
                          toast.success('Items updated');
                        })
                        .catch((err: unknown) => toast.error(errorMessage(err)))
                    }
                  >
                    {m.update.isPending ? <Spinner /> : null} Save items
                  </Button>
                </div>
              </Section>
              <PreviewPanel
                stateCode={o.shippingAddress.stateCode}
                city={o.shippingAddress.city}
                lines={editing}
              />
            </div>
          ) : (
            <ItemsSection
              order={o}
              onEdit={
                canEditLines
                  ? () =>
                      setEditing(
                        o.items.map((l) => ({
                          productId: l.productId,
                          name: l.name,
                          sku: l.sku,
                          netPrice: l.netPrice,
                          stock: null,
                          qty: l.qty,
                        })),
                      )
                  : undefined
              }
            />
          )}
          <PaymentsSection
            order={o}
            canVoid={can('payments:void')}
            onVoid={(payment) => setDialog({ kind: 'void', payment })}
          />
          <Timeline order={o} />
        </div>

        <div className="grid gap-4 lg:sticky lg:top-20">
          <CustomerCard
            order={o}
            profile={can('customers:read')}
            onEdit={canEditLines ? () => setDialog({ kind: 'delivery' }) : undefined}
          />
          <DispatchCard
            order={o}
            onEdit={
              can('orders:dispatch') && o.status !== 'enquiry' && o.status !== 'cancelled'
                ? () => setDialog({ kind: 'dispatch', andMark: false })
                : undefined
            }
          />
        </div>
      </div>

      {actions.length > 0 && !editing ? (
        <StickyActions className="mt-4 overflow-x-auto md:hidden [&>*]:flex-1 [&>*]:shrink-0">
          {actions}
        </StickyActions>
      ) : null}

      {dialog?.kind === 'payment' ? <PaymentDialog order={o} onClose={close} /> : null}
      {dialog?.kind === 'void' ? (
        <VoidPaymentDialog order={o} payment={dialog.payment} onClose={close} />
      ) : null}
      {dialog?.kind === 'cancel' ? <CancelOrderDialog order={o} onClose={close} /> : null}
      {dialog?.kind === 'delivery' ? <DeliveryDetailsDialog order={o} onClose={close} /> : null}
      {dialog?.kind === 'shortage' ? (
        <ShortageDialog order={o} shortages={dialog.items} onClose={close} />
      ) : null}
      {dialog?.kind === 'dispatch' ? (
        <DispatchDialog
          order={o}
          onClose={close}
          onSavedAndDispatch={
            dialog.andMark && o.status === 'packed'
              ? async (updated) => {
                  await m.transition.mutateAsync({ to: 'dispatched', version: updated.version });
                  toast.success('Dispatched. Send the LR number on WhatsApp.');
                }
              : undefined
          }
        />
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === 'packCredit'}
        onOpenChange={(open) => !open && close()}
        title="Pack before payment?"
        description={`${o.customer.name} is allowed credit. ${money(o.balanceDue)} will remain due. This is recorded in the audit log.`}
        confirmLabel="Pack on credit"
        onConfirm={() => move('packed', 'Packed on credit')}
      />
    </>
  );
}

// ------------------------------------------------------------------ sections

function ItemsSection({ order: o, onEdit }: { order: OrderDto; onEdit?: () => void }) {
  return (
    <section className="bg-card rounded-xl border">
      <div className="flex items-center justify-between gap-2 p-4 pb-2 sm:px-5">
        <h2 className="font-medium">
          Items <span className="text-muted-foreground text-sm font-normal">({number(o.items.length)})</span>
        </h2>
        {onEdit ? (
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil /> Edit items
          </Button>
        ) : null}
      </div>
      {/* Phones */}
      <ul className="divide-y border-t md:hidden">
        {o.items.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">{l.name}</p>
              <p className="text-muted-foreground text-xs">
                <span className="font-mono">{l.sku}</span> · {number(l.qty)} × {money(l.netPrice)}
              </p>
            </div>
            <p className="font-medium tabular-nums">{money(l.lineTotal)}</p>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Product</TableHead>
              <TableHead className="text-right">MRP</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="pr-5 text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.items.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="pl-5">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{l.sku}</span> · {l.categoryName} · GST {l.taxRate}%
                  </p>
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums line-through">
                  {money(l.mrp)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(l.netPrice)}</TableCell>
                <TableCell className="text-right tabular-nums">{number(l.qty)}</TableCell>
                <TableCell className="pr-5 text-right font-medium tabular-nums">
                  {money(l.lineTotal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-5" colSpan={3}>
                Total quantity
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {number(o.items.reduce((s, l) => s + l.qty, 0))}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="border-t p-4 sm:px-5">
        <div className="ml-auto max-w-sm">
          <TotalsBlock pricing={o.pricing} />
        </div>
        {o.customerNotes ? (
          <p className="bg-muted mt-4 rounded-lg p-3 text-sm">
            <span className="font-medium">Customer note: </span>
            {o.customerNotes}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PaymentsSection({
  order: o,
  canVoid,
  onVoid,
}: {
  order: OrderDto;
  canVoid: boolean;
  onVoid: (p: PaymentDto) => void;
}) {
  if (o.status === 'enquiry' && o.payments.length === 0) return null;
  return (
    <Section title="Payments">
      <dl className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-medium tabular-nums">{money(o.pricing.grandTotal)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="font-medium tabular-nums">{money(o.amountPaid)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{o.balanceDue < 0 ? 'Excess' : 'Balance'}</dt>
          <dd
            className={cn(
              'font-medium tabular-nums',
              o.balanceDue > 0 && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {money(Math.abs(o.balanceDue))}
          </dd>
        </div>
      </dl>
      {o.payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No payments recorded yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {o.payments.map((p) => {
            const voided = p.status === 'voided';
            return (
              <li key={p.id} className={cn('flex flex-wrap items-center gap-3 p-3', voided && 'opacity-60')}>
                {p.screenshotUrl ? (
                  <a
                    href={p.screenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                    aria-label="Open payment screenshot"
                  >
                    <img src={p.screenshotUrl} alt="" className="size-11 rounded-md border object-cover" />
                  </a>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className={cn('font-medium tabular-nums', voided && 'line-through')}>
                    {p.kind === 'refund' ? '− ' : ''}
                    {money(p.amount)}{' '}
                    <span className="text-muted-foreground text-sm font-normal">
                      {METHOD_LABEL[p.method]}
                    </span>
                    {p.kind === 'refund' ? (
                      <Badge variant="outline" className="ml-2">
                        Refund
                      </Badge>
                    ) : null}
                    {voided ? (
                      <Badge variant="destructive" className="ml-2">
                        Void
                      </Badge>
                    ) : null}
                    {p.status === 'submitted' ? (
                      <Badge variant="secondary" className="ml-2">
                        From customer, to verify
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {p.reference ? <span className="font-mono">{p.reference}</span> : 'No reference'} ·{' '}
                    {dateTime(p.paidAt)}
                    {p.recordedBy ? ` · by ${p.recordedBy}` : ''}
                  </p>
                  {voided && p.voidReason ? (
                    <p className="text-destructive text-xs">Voided: {p.voidReason}</p>
                  ) : null}
                  {p.notes ? <p className="text-xs">{p.notes}</p> : null}
                </div>
                {canVoid && p.status === 'recorded' ? (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onVoid(p)}>
                    Void
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function CustomerCard({
  order: o,
  profile,
  onEdit,
}: {
  order: OrderDto;
  profile: boolean;
  onEdit?: () => void;
}) {
  const a = o.shippingAddress;
  return (
    <Section title="Customer">
      <div className="grid gap-1 text-sm">
        <p className="font-medium">
          {profile ? (
            <Link
              to={`/customers/${o.customer.id}`}
              className="hover:text-primary underline-offset-4 hover:underline"
            >
              {o.customer.name}
            </Link>
          ) : (
            o.customer.name
          )}
          {o.customer.isBlocked ? (
            <Badge variant="destructive" className="ml-2">
              Blocked
            </Badge>
          ) : null}
          {o.customer.creditAllowed ? (
            <Badge variant="outline" className="ml-2">
              Credit
            </Badge>
          ) : null}
        </p>
        <a
          href={`tel:+91${o.customer.phone}`}
          className="text-primary inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
        >
          <Phone className="size-3.5" aria-hidden /> {o.customer.phone}
        </a>
        {o.customer.altPhone ? <p className="text-muted-foreground">Alt: {o.customer.altPhone}</p> : null}
        {o.customer.email ? <p className="text-muted-foreground truncate">{o.customer.email}</p> : null}
        {o.customer.gstin ? <p className="font-mono text-xs">GSTIN {o.customer.gstin}</p> : null}
      </div>
      <address className="mt-3 border-t pt-3 text-sm not-italic">
        {a.line1}
        {a.line2 ? <>, {a.line2}</> : null}
        <br />
        {a.landmark ? (
          <>
            Near {a.landmark}
            <br />
          </>
        ) : null}
        {a.city}
        {a.district ? `, ${a.district}` : ''} – {a.pincode}
        <br />
        {stateName(a.stateCode)}
        {o.zoneName ? <span className="text-muted-foreground"> · {o.zoneName}</span> : null}
      </address>
      {onEdit ? (
        <Button size="sm" variant="outline" className="mt-3" onClick={onEdit}>
          <Pencil /> Edit delivery details
        </Button>
      ) : null}
    </Section>
  );
}

function DispatchCard({ order: o, onEdit }: { order: OrderDto; onEdit?: () => void }) {
  const d = o.dispatch;
  return (
    <Section title="Dispatch">
      {d.lrNumber ? (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Transport</dt>
          <dd>{d.transportName}</dd>
          <dt className="text-muted-foreground">LR number</dt>
          <dd className="font-mono">
            {d.trackingUrl ? (
              <a
                href={d.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {d.lrNumber}
              </a>
            ) : (
              d.lrNumber
            )}
          </dd>
          <dt className="text-muted-foreground">Date</dt>
          <dd>
            {d.dispatchDate
              ? new Date(d.dispatchDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
              : '—'}
          </dd>
          <dt className="text-muted-foreground">Boxes</dt>
          <dd>
            {d.boxes ?? '—'}
            {d.weightKg ? ` · ${d.weightKg} kg` : ''}
          </dd>
          {d.destination ? (
            <>
              <dt className="text-muted-foreground">Deliver to</dt>
              <dd>{d.destination}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-muted-foreground text-sm">
          {o.status === 'enquiry' ? 'Confirm the order first.' : 'Not dispatched yet.'}
        </p>
      )}
      {onEdit ? (
        <Button size="sm" variant="outline" className="mt-3" onClick={onEdit}>
          <Truck /> {d.lrNumber ? 'Edit details' : 'Add dispatch details'}
        </Button>
      ) : null}
    </Section>
  );
}

function WhatsAppMenu({ order: o, suggested }: { order: OrderDto; suggested?: WhatsAppEvent }) {
  const events = WA_EVENTS.filter((e) => e.when(o));
  if (events.length === 0) return null;
  const primary = events.find((e) => e.event === suggested) ?? events[0];
  return (
    <div className="flex">
      <Button
        variant="outline"
        className="rounded-r-none border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
        onClick={() => primary && void openWhatsApp(o.id, primary.event)}
        title={primary?.label}
      >
        <MessageCircle /> WhatsApp
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-l-none border-l-0 border-emerald-600/40"
            aria-label="Other WhatsApp messages"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Send on WhatsApp</DropdownMenuLabel>
          {events.map((e) => (
            <DropdownMenuItem key={e.event} onSelect={() => void openWhatsApp(o.id, e.event)}>
              {e.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ------------------------------------------------------------------ timeline

const ACTIVITY_TEXT: Partial<Record<OrderActivityDto['type'], string>> = {
  items_edited: 'Order edited',
  payment_submitted: 'Payment proof submitted',
  payment_recorded: 'Payment recorded',
  payment_rejected: 'Payment rejected',
  payment_voided: 'Payment voided',
  dispatch_updated: 'Dispatch details updated',
  invoice_generated: 'Invoice issued',
  credit_note_issued: 'Credit note issued',
  packed_on_credit: 'Packed on credit',
  notification_sent: 'Message sent',
};

function Timeline({ order: o }: { order: OrderDto }) {
  const { comment } = useOrderMutations(o.id);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(true);
  const items = o.activity; // newest first, as sent by the API
  const post = () => {
    if (!text.trim()) return;
    comment
      .mutateAsync({ message: text.trim(), isInternal: internal })
      .then(() => setText(''))
      .catch((err: unknown) => toast.error(errorMessage(err)));
  };
  return (
    <Section title="Timeline & notes">
      <div className="mb-4 grid gap-2">
        <Textarea
          aria-label="Add a note"
          rows={2}
          placeholder="Add a note: call outcome, special packing, promised date…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post();
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={internal} onCheckedChange={setInternal} /> Staff only
          </label>
          <Button size="sm" onClick={post} disabled={comment.isPending || !text.trim()}>
            {comment.isPending ? <Spinner /> : null} Add note
          </Button>
        </div>
      </div>
      <ol className="relative grid gap-4 border-l pl-4">
        {items.map((a) => (
          <li key={a.id} className="relative">
            <span
              className={cn(
                'absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background',
                a.type === 'status_change'
                  ? 'bg-primary'
                  : a.type === 'internal_comment' || a.type === 'note'
                    ? 'bg-sky-500'
                    : 'bg-muted-foreground',
              )}
              aria-hidden
            />
            <p className="text-sm">
              {a.type === 'status_change' ? (
                <span className="font-medium">
                  {a.fromStatus ? `${STATUS_LABEL[a.fromStatus]} → ` : ''}
                  {a.toStatus ? STATUS_LABEL[a.toStatus] : ''}
                </span>
              ) : a.type === 'internal_comment' || a.type === 'note' ? null : (
                <span className="font-medium">{ACTIVITY_TEXT[a.type] ?? a.type}</span>
              )}
              {a.message ? (
                <span
                  className={cn(
                    a.type !== 'internal_comment' && a.type !== 'note' && 'text-muted-foreground',
                  )}
                >
                  {a.type === 'internal_comment' || a.type === 'note' ? '' : ': '}
                  {a.message}
                </span>
              ) : null}
              {a.type === 'internal_comment' ? (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  Staff only
                </Badge>
              ) : null}
            </p>
            <p className="text-muted-foreground text-xs">
              {a.actor ?? 'Customer'} · {dateTime(a.createdAt)}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
