import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Ban,
  ChevronLeft,
  CircleCheck,
  HandCoins,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { INDIAN_STATES, type CustomerDto } from '@sakthimaan/shared';
import { AddressFields, addressBody, addressDraft, type AddressDraft } from '@/components/address-fields';
import {
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  Section,
  Spinner,
  TableSkeleton,
} from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage } from '@/lib/api';
import { dateTime, money, number } from '@/lib/format';
import { PHONE_SHEET, cn } from '@/lib/utils';
import { useOrders } from '../orders/api';
import { OrderStatusBadge, PaymentBadge } from '../orders/order-bits';
import { useCustomer, useCustomerMutations } from '../settings/api';
import { CustomerFlags } from './customers-page';

const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
const issuesOf = (err: unknown) =>
  err instanceof ApiError ? Object.fromEntries(err.issues.map((i) => [i.path, i.message])) : {};

type DialogState = 'edit' | 'block' | 'credit' | { address: number | 'new' } | null;

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const customer = useCustomer(id);
  const { can } = useAuth();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [page, setPage] = useState(1);
  const orders = useOrders({ customerId: id, page, pageSize: 10 });

  if (customer.isError) return <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />;
  if (customer.isPending) return <TableSkeleton rows={8} cols={3} />;
  const c = customer.data;
  const close = () => setDialog(null);

  return (
    <>
      <PageHeader
        title={c.name}
        back={
          <Link
            to="/customers"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm max-lg:-ml-2 max-lg:min-h-11 max-lg:px-2"
          >
            <ChevronLeft className="size-4" aria-hidden /> Customers
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <CustomerFlags c={c} />
            {c.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
            <span>
              Customer since{' '}
              {new Date(c.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
            </span>
          </span>
        }
        actions={
          <>
            {can('orders:create') && !c.isBlocked ? (
              <Button onClick={() => navigate(`/orders/new?phone=${c.phone}`)}>
                <Plus /> New order
              </Button>
            ) : null}
            {can('customers:update') ? (
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil /> Edit
              </Button>
            ) : null}
            {can('customers:credit') ? (
              <Button variant="outline" onClick={() => setDialog('credit')}>
                <HandCoins /> {c.creditAllowed ? 'Credit…' : 'Allow credit'}
              </Button>
            ) : null}
            {can('customers:block') ? (
              <Button
                variant="outline"
                className={c.isBlocked ? '' : 'text-destructive'}
                onClick={() => setDialog('block')}
              >
                {c.isBlocked ? <CircleCheck /> : <Ban />} {c.isBlocked ? 'Unblock' : 'Block'}
              </Button>
            ) : null}
          </>
        }
      />

      {c.isBlocked ? (
        <p className="border-destructive/30 bg-destructive/5 text-destructive mb-4 rounded-lg border px-3 py-2 text-sm">
          Blocked {c.blockedAt ? dateTime(c.blockedAt) : ''}
          {c.blockedReason ? `: ${c.blockedReason}` : ''}. The website refuses their orders.
        </p>
      ) : null}

      <section aria-label="Totals" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Confirmed orders', number(c.stats.orderCount)],
          ['Total paid', money(c.stats.totalSpent)],
          ['Still to pay', money(c.stats.outstanding)],
          ['Open enquiries', number(c.stats.openEnquiries)],
        ].map(([label, value], i) => (
          <div key={label} className="bg-card rounded-xl border p-3">
            <p className="text-muted-foreground text-sm">{label}</p>
            <p
              className={cn(
                'text-xl font-semibold tabular-nums',
                i === 2 && c.stats.outstanding > 0 && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {value}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <Section title="Orders">
          {orders.isError ? (
            <ErrorState error={orders.error} />
          ) : orders.isPending ? (
            <TableSkeleton rows={4} cols={3} />
          ) : orders.data.data.length === 0 ? (
            <EmptyState title="No orders yet" />
          ) : (
            <>
              <ul className="divide-y rounded-lg border">
                {orders.data.data.map((o) => (
                  <li key={o.id}>
                    <Link
                      to={`/orders/${o.id}`}
                      className="hover:bg-muted/50 flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
                    >
                      <span className="font-mono text-sm font-medium">{o.orderNo}</span>
                      <OrderStatusBadge status={o.status} />
                      <PaymentBadge status={o.paymentStatus} />
                      <span className="text-muted-foreground text-xs">{dateTime(o.createdAt)}</span>
                      <span className="ml-auto font-medium tabular-nums">{money(o.grandTotal)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination page={page} pageSize={10} total={orders.data.meta?.total ?? 0} onPage={setPage} />
            </>
          )}
        </Section>

        <div className="grid gap-4">
          <Section title="Contact">
            <div className="grid gap-1 text-sm">
              <a
                href={`tel:+91${c.phone}`}
                className="text-primary inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
              >
                <Phone className="size-3.5" aria-hidden /> {c.phone}
              </a>
              {c.altPhone ? <p>Alt: {c.altPhone}</p> : null}
              {c.email ? <p className="truncate">{c.email}</p> : null}
              {c.gstin ? <p className="font-mono text-xs">GSTIN {c.gstin}</p> : null}
            </div>
            {c.notes ? (
              <p className="bg-muted mt-3 rounded-lg p-3 text-sm whitespace-pre-wrap">{c.notes}</p>
            ) : null}
          </Section>
          <Section title="Addresses">
            {c.addresses.length === 0 ? (
              <p className="text-muted-foreground text-sm">No saved address.</p>
            ) : (
              <ul className="grid gap-2">
                {c.addresses.map((a, i) => (
                  <li key={a.id} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                    <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {a.label ?? `Address ${i + 1}`}{' '}
                        {a.isDefault ? (
                          <Badge variant="outline" className="ml-1">
                            <Star className="size-3" aria-hidden /> Default
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground">
                        {[a.address.line1, a.address.line2, a.address.landmark, a.address.city]
                          .filter(Boolean)
                          .join(', ')}{' '}
                        – {a.address.pincode}, {stateName(a.address.stateCode)}
                      </p>
                    </div>
                    {can('customers:update') ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit address ${i + 1}`}
                        onClick={() => setDialog({ address: i })}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {can('customers:update') && c.addresses.length < 10 ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setDialog({ address: 'new' })}
              >
                <Plus /> Add address
              </Button>
            ) : null}
          </Section>
        </div>
      </div>

      {dialog === 'edit' ? <EditCustomerDialog c={c} onClose={close} /> : null}
      {dialog === 'block' ? <BlockDialog c={c} onClose={close} /> : null}
      {dialog === 'credit' ? <CreditDialog c={c} onClose={close} /> : null}
      {dialog && typeof dialog === 'object' ? (
        <AddressDialog c={c} index={dialog.address} onClose={close} />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ dialogs

function EditCustomerDialog({ c, onClose }: { c: CustomerDto; onClose: () => void }) {
  const { update } = useCustomerMutations(c.id);
  const [f, setF] = useState({
    name: c.name,
    phone: c.phone,
    altPhone: c.altPhone ?? '',
    email: c.email ?? '',
    gstin: c.gstin ?? '',
    tags: c.tags.join(', '),
    notes: c.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  const save = async () => {
    setErrors({});
    try {
      await update.mutateAsync({
        name: f.name,
        phone: f.phone,
        altPhone: nul(f.altPhone),
        email: nul(f.email),
        gstin: nul(f.gstin),
        notes: nul(f.notes),
        tags: f.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success('Customer updated');
      onClose();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-lg', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Edit customer</DialogTitle>
          <DialogDescription>
            Past orders and invoices keep the details they were placed with.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="cu-name" error={errors.name} required>
            <Input id="cu-name" value={f.name} onChange={set('name')} />
          </Field>
          <Field
            label="Mobile"
            htmlFor="cu-phone"
            error={errors.phone}
            required
            hint={f.phone !== c.phone ? 'Changes who future orders from this number belong to' : undefined}
          >
            <Input id="cu-phone" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Alternate mobile" htmlFor="cu-alt" error={errors.altPhone}>
            <Input id="cu-alt" type="tel" inputMode="tel" value={f.altPhone} onChange={set('altPhone')} />
          </Field>
          <Field label="Email" htmlFor="cu-email" error={errors.email}>
            <Input id="cu-email" type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="GSTIN" htmlFor="cu-gstin" error={errors.gstin}>
            <Input
              id="cu-gstin"
              className="uppercase"
              maxLength={15}
              value={f.gstin}
              onChange={set('gstin')}
            />
          </Field>
          <Field
            label="Tags"
            htmlFor="cu-tags"
            error={errors.tags}
            hint="Separate with commas, e.g. wholesale, repeat"
          >
            <Input id="cu-tags" value={f.tags} onChange={set('tags')} />
          </Field>
          <Field label="Notes (staff only)" htmlFor="cu-notes" error={errors.notes} className="sm:col-span-2">
            <Textarea id="cu-notes" rows={3} value={f.notes} onChange={set('notes')} />
          </Field>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={update.isPending}>
            {update.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddressDialog({
  c,
  index,
  onClose,
}: {
  c: CustomerDto;
  index: number | 'new';
  onClose: () => void;
}) {
  const { update } = useCustomerMutations(c.id);
  const existing = index === 'new' ? null : c.addresses[index];
  const [label, setLabel] = useState(existing?.label ?? '');
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? c.addresses.length === 0);
  const [addr, setAddr] = useState<AddressDraft>(addressDraft(existing?.address));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const all = c.addresses.map((a) => ({
    label: a.label ?? undefined,
    isDefault: a.isDefault,
    address: addressBody(addressDraft(a.address)),
  }));
  const pos = index === 'new' ? all.length : index;
  const send = async (addresses: typeof all, ok: string) => {
    setErrors({});
    try {
      await update.mutateAsync({ addresses });
      toast.success(ok);
      onClose();
    } catch (err) {
      const prefix = `addresses.${pos}.address.`;
      setErrors(
        Object.fromEntries(
          Object.entries(issuesOf(err)).map(([k, v]) => [
            k.startsWith(prefix) ? k.slice(prefix.length) : k,
            v,
          ]),
        ),
      );
      toast.error(errorMessage(err));
    }
  };
  const save = () => {
    if (!addr.stateCode) return setErrors({ stateCode: 'Choose a state' });
    const entry = { label: label.trim() || undefined, isDefault, address: addressBody(addr) };
    const next = all.map((a) => (isDefault ? { ...a, isDefault: false } : a));
    if (index === 'new') next.push(entry);
    else next[index] = entry;
    void send(next, 'Address saved');
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-lg', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit address' : 'Add address'}</DialogTitle>
          <DialogDescription>Used to fill in new orders for {c.name}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Field label="Label" htmlFor="ad-label" hint="Home, Shop, Godown…">
              <Input id="ad-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <label className="flex h-9 items-center gap-2 text-sm">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} /> Default
            </label>
          </div>
          <AddressFields idPrefix="ad" value={addr} onChange={setAddr} errors={errors} />
        </div>
        <DialogFooter className="gap-2">
          {existing ? (
            <Button
              variant="ghost"
              className="text-destructive sm:mr-auto"
              disabled={update.isPending}
              onClick={() =>
                void send(
                  all.filter((_, i) => i !== index),
                  'Address removed',
                )
              }
            >
              <Trash2 /> Remove
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlockDialog({ c, onClose }: { c: CustomerDto; onClose: () => void }) {
  const { block } = useCustomerMutations(c.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const blocking = !c.isBlocked;
  const save = async () => {
    if (blocking && reason.trim().length < 3) return setError('Say why (staff see this)');
    try {
      await block.mutateAsync({ blocked: blocking, reason: reason.trim() || undefined });
      toast.success(blocking ? `${c.name} blocked` : `${c.name} unblocked`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{blocking ? `Block ${c.name}?` : `Unblock ${c.name}?`}</DialogTitle>
          <DialogDescription>
            {blocking
              ? 'The website will refuse their orders and staff see a warning. Existing orders are not changed. Recorded in the audit log.'
              : 'They can order again. Recorded in the audit log.'}
          </DialogDescription>
        </DialogHeader>
        {blocking ? (
          <Field label="Reason" htmlFor="bl-reason" error={error} required>
            <Textarea
              id="bl-reason"
              rows={2}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Fake orders, unpaid dues"
            />
          </Field>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={blocking ? 'destructive' : 'default'}
            onClick={() => void save()}
            disabled={block.isPending}
          >
            {block.isPending ? <Spinner /> : null} {blocking ? 'Block customer' : 'Unblock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({ c, onClose }: { c: CustomerDto; onClose: () => void }) {
  const { credit } = useCustomerMutations(c.id);
  const [reason, setReason] = useState('');
  const allowing = !c.creditAllowed;
  const save = async () => {
    try {
      await credit.mutateAsync({ creditAllowed: allowing, reason: reason.trim() || undefined });
      toast.success(allowing ? 'Credit allowed' : 'Credit withdrawn');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>
            {allowing ? `Allow credit for ${c.name}?` : `Withdraw credit for ${c.name}?`}
          </DialogTitle>
          <DialogDescription>
            {allowing
              ? 'Their confirmed orders can be packed before payment by users allowed to pack unpaid orders. Each use is audited.'
              : 'Orders will need payment before packing again.'}
            {c.stats.outstanding > 0 ? ` They currently owe ${money(c.stats.outstanding)}.` : ''}
          </DialogDescription>
        </DialogHeader>
        <Field label="Note for the audit log" htmlFor="cr-reason">
          <Input
            id="cr-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Regular wholesale buyer since 2019"
          />
        </Field>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={credit.isPending}>
            {credit.isPending ? <Spinner /> : null} {allowing ? 'Allow credit' : 'Withdraw credit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
