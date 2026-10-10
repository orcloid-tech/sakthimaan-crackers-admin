import { useState } from 'react';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  PAYMENT_METHODS,
  type OrderDto,
  type PaymentDto,
  type PaymentMethod,
  type ProductDto,
  type ShortageItem,
} from '@sakthimaan/shared';
import { Field, Spinner } from '@/components/common';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { money, number, parseRupees, rupeesText } from '@/lib/format';
import { PHONE_SHEET, cn } from '@/lib/utils';
import { ProductPicker } from '../products/product-picker';
import { useOrderMutations, useTransportPartners } from './api';
import { METHOD_LABEL } from './order-bits';

/** Local date-time for <input type="datetime-local"> (IST on staff devices). */
function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const issuesOf = (err: unknown) =>
  err instanceof ApiError ? Object.fromEntries(err.issues.map((i) => [i.path, i.message])) : {};

// ------------------------------------------------------------------ payment

/**
 * Record a UPI / bank / cash payment (or a refund) with its reference and an optional
 * screenshot. On a phone the file picker offers the camera and the gallery.
 */
export function PaymentDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const { recordPayment } = useOrderMutations(order.id);
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const [amount, setAmount] = useState(rupeesText(Math.max(0, order.balanceDue)));
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(localNow());
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const paise = parseRupees(amount);

  const save = async () => {
    setErrors({});
    if (paise === null || paise <= 0) return setErrors({ amount: 'Enter the amount' });
    if (method !== 'cash' && !reference.trim())
      return setErrors({ reference: 'Enter the UTR / reference number' });
    const form = new FormData();
    form.set('kind', kind);
    form.set('amount', String(paise));
    form.set('method', method);
    if (reference.trim()) form.set('reference', reference.trim());
    form.set('paidAt', new Date(paidAt).toISOString());
    if (notes.trim()) form.set('notes', notes.trim());
    if (file) form.set('files', file);
    try {
      const res = await recordPayment.mutateAsync(form);
      for (const w of res.warnings) toast.warning(w);
      toast.success(kind === 'refund' ? 'Refund recorded' : `Payment of ${money(paise)} recorded`);
      onClose();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{kind === 'refund' ? 'Record refund' : 'Record payment'}</DialogTitle>
          <DialogDescription>
            {order.orderNo} · Total {money(order.pricing.grandTotal)} · Balance {money(order.balanceDue)}
          </DialogDescription>
        </DialogHeader>
        <form
          id="payment-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {order.amountPaid > 0 ? (
            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v as typeof kind)}
              className="grid grid-cols-2 gap-2"
            >
              {(['payment', 'refund'] as const).map((k) => (
                <label
                  key={k}
                  className="has-data-[state=checked]:border-primary flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
                >
                  <RadioGroupItem value={k} /> {k === 'payment' ? 'Payment received' : 'Refund given'}
                </label>
              ))}
            </RadioGroup>
          ) : null}
          <Field label="Amount (₹)" htmlFor="pay-amount" error={errors.amount} required>
            <Input
              id="pay-amount"
              inputMode="decimal"
              className="h-12 text-lg tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!!errors.amount}
            />
          </Field>
          <div role="radiogroup" aria-label="Method" className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                variant={method === m ? 'default' : 'outline'}
                className="h-11"
                onClick={() => setMethod(m)}
              >
                {METHOD_LABEL[m]}
              </Button>
            ))}
          </div>
          <Field
            label={
              method === 'upi'
                ? 'UTR / UPI reference'
                : method === 'bank_transfer'
                  ? 'UTR / transaction reference'
                  : 'Receipt number'
            }
            htmlFor="pay-ref"
            error={errors.reference}
            required={method !== 'cash'}
            hint="Checked against other payments to catch duplicates."
          >
            <Input
              id="pay-ref"
              value={reference}
              autoComplete="off"
              onChange={(e) => setReference(e.target.value)}
              aria-invalid={!!errors.reference}
            />
          </Field>
          <Field label="Paid on" htmlFor="pay-at" error={errors.paidAt}>
            <Input
              id="pay-at"
              type="datetime-local"
              value={paidAt}
              max={localNow()}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </Field>
          <Field label="Screenshot" htmlFor="pay-file" hint="JPG, PNG or WebP">
            {file ? (
              <div className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <img src={URL.createObjectURL(file)} alt="" className="size-12 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove screenshot"
                  onClick={() => setFile(null)}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <label
                htmlFor="pay-file"
                className="hover:bg-muted flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-sm"
              >
                <Camera className="size-4" aria-hidden /> Add screenshot
              </label>
            )}
            <input
              id="pay-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Notes" htmlFor="pay-notes">
            <Input id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" disabled={recordPayment.isPending}>
            {recordPayment.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ void payment

export function VoidPaymentDialog({
  order,
  payment,
  onClose,
}: {
  order: OrderDto;
  payment: PaymentDto;
  onClose: () => void;
}) {
  const { voidPayment } = useOrderMutations(order.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    if (reason.trim().length < 3) return setError('Say why this payment is being voided');
    try {
      await voidPayment.mutateAsync({ paymentId: payment.id, reason: reason.trim() });
      toast.success('Payment voided');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Void payment</DialogTitle>
          <DialogDescription>
            {money(payment.amount)} by {METHOD_LABEL[payment.method]}
            {payment.reference ? ` (${payment.reference})` : ''}. It stays on record, marked void.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="void-reason" error={error} required>
          <Textarea
            id="void-reason"
            rows={2}
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Entered twice, amount not received"
          />
        </Field>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={voidPayment.isPending}>
            {voidPayment.isPending ? <Spinner /> : null} Void payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ dispatch

const OTHER = '__other__';

/** Transport, LR number, date and boxes. Optionally marks the order dispatched in the same step. */
export function DispatchDialog({
  order,
  onClose,
  onSavedAndDispatch,
}: {
  order: OrderDto;
  onClose: () => void;
  /** When set, a "Save & mark dispatched" button is shown. */
  onSavedAndDispatch?: (updated: OrderDto) => Promise<unknown>;
}) {
  const partners = useTransportPartners();
  const { dispatch } = useOrderMutations(order.id);
  const d = order.dispatch;
  const [partnerId, setPartnerId] = useState(d.transportPartnerId ?? (d.transportName ? OTHER : ''));
  const [transportName, setTransportName] = useState(d.transportName ?? '');
  const [lrNumber, setLr] = useState(d.lrNumber ?? '');
  const [dispatchDate, setDate] = useState(
    d.dispatchDate ? d.dispatchDate.slice(0, 10) : localNow().slice(0, 10),
  );
  const [boxes, setBoxes] = useState(d.boxes ? String(d.boxes) : '');
  const [weightKg, setWeight] = useState(d.weightKg ? String(d.weightKg) : '');
  const [destination, setDestination] = useState(d.destination ?? order.shippingAddress.city);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async (andDispatch: boolean) => {
    setErrors({});
    const partner = partners.data?.find((p) => p.id === partnerId);
    const name = partner?.name ?? transportName.trim();
    const e: Record<string, string> = {};
    if (!name) e.transportName = 'Choose or enter the transport';
    if (!lrNumber.trim()) e.lrNumber = 'Enter the LR number';
    if (!(Number(boxes) >= 1)) e.boxes = 'How many boxes?';
    if (Object.keys(e).length) return setErrors(e);
    setBusy(true);
    try {
      const updated = await dispatch.mutateAsync({
        transportPartnerId: partner?.id ?? null,
        transportName: name,
        lrNumber: lrNumber.trim(),
        dispatchDate,
        boxes: Number(boxes),
        weightKg: weightKg ? Number(weightKg) : undefined,
        destination: destination.trim() || undefined,
      });
      if (andDispatch && onSavedAndDispatch) await onSavedAndDispatch(updated);
      else toast.success('Dispatch details saved');
      onClose();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Dispatch details</DialogTitle>
          <DialogDescription>
            {order.orderNo} to {order.shippingAddress.city}, {order.shippingAddress.stateCode}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Transport" htmlFor="dp-partner" error={errors.transportName} required>
            <Select
              value={partnerId}
              onValueChange={(v) => {
                setPartnerId(v);
                if (v !== OTHER) setTransportName('');
              }}
            >
              <SelectTrigger id="dp-partner" className="w-full">
                <SelectValue placeholder={partners.isPending ? 'Loading…' : 'Choose transport'} />
              </SelectTrigger>
              <SelectContent>
                {(partners.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.servedStates.length && !p.servedStates.includes(order.shippingAddress.stateCode)
                      ? ' (not usual for this state)'
                      : ''}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {partnerId === OTHER ? (
            <Field label="Transport name" htmlFor="dp-name" error={errors.transportName} required>
              <Input id="dp-name" value={transportName} onChange={(e) => setTransportName(e.target.value)} />
            </Field>
          ) : null}
          <Field label="LR number" htmlFor="dp-lr" error={errors.lrNumber} required>
            <Input
              id="dp-lr"
              className="h-11 font-mono"
              autoComplete="off"
              value={lrNumber}
              onChange={(e) => setLr(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Boxes" htmlFor="dp-boxes" error={errors.boxes} required>
              <Input
                id="dp-boxes"
                className="h-11"
                inputMode="numeric"
                pattern="[0-9]*"
                value={boxes}
                onChange={(e) => setBoxes(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label="Weight (kg)" htmlFor="dp-kg" error={errors.weightKg}>
              <Input
                id="dp-kg"
                className="h-11"
                inputMode="decimal"
                value={weightKg}
                onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </Field>
            <Field label="Dispatch date" htmlFor="dp-date" error={errors.dispatchDate}>
              <Input
                id="dp-date"
                type="date"
                value={dispatchDate}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Delivery point" htmlFor="dp-dest">
              <Input id="dp-dest" value={destination} onChange={(e) => setDestination(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={onSavedAndDispatch ? 'outline' : 'default'}
            onClick={() => void save(false)}
            disabled={busy}
          >
            Save
          </Button>
          {onSavedAndDispatch ? (
            <Button onClick={() => void save(true)} disabled={busy}>
              {busy ? <Spinner /> : null} Save & mark dispatched
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ cancel

export function CancelOrderDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const { transition } = useOrderMutations(order.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const confirmed = order.status !== 'enquiry';
  const save = async () => {
    if (reason.trim().length < 3) return setError('Give a reason (the customer may see it)');
    try {
      const o = await transition.mutateAsync({
        to: 'cancelled',
        version: order.version,
        reason: reason.trim(),
      });
      toast.success(
        o.creditNotes.length
          ? `Cancelled. Credit note ${o.creditNotes.at(-1)?.number} issued.`
          : 'Order cancelled',
      );
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Cancel {order.orderNo}?</DialogTitle>
          <DialogDescription>
            {confirmed ? 'Stock goes back to inventory. ' : ''}
            {order.invoice ? `A credit note will be issued against invoice ${order.invoice.number}. ` : ''}
            {order.amountPaid > 0 ? `${money(order.amountPaid)} was paid: record the refund afterwards.` : ''}
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="cancel-reason" error={error} required>
          <Textarea
            id="cancel-reason"
            rows={2}
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep order
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={transition.isPending}>
            {transition.isPending ? <Spinner /> : null} Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ shortages on confirm

type Fix =
  | { action: 'reduce' }
  | { action: 'remove' }
  | { action: 'substitute'; product: ProductDto | null; qty: number };

/**
 * Shown when confirming fails for lack of stock. For each short line: reduce to what is
 * in stock, remove it, or substitute another product. Then the enquiry is updated and
 * confirmed in one go (with the version check, so concurrent edits are not lost).
 */
export function ShortageDialog({
  order,
  shortages,
  onClose,
}: {
  order: OrderDto;
  shortages: ShortageItem[];
  onClose: () => void;
}) {
  const { update, transition } = useOrderMutations(order.id);
  const [fixes, setFixes] = useState<Record<string, Fix>>(() =>
    Object.fromEntries(
      shortages.map((s) => [s.productId, s.available > 0 ? { action: 'reduce' } : { action: 'remove' }]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<ShortageItem[] | null>(null);
  const rows = left ?? shortages;

  const apply = async () => {
    const items: { productId: string; qty: number }[] = [];
    for (const line of order.items) {
      const fix = fixes[line.productId];
      if (!fix) items.push({ productId: line.productId, qty: line.qty });
      else if (fix.action === 'reduce') {
        const s = rows.find((r) => r.productId === line.productId);
        if (s && s.available > 0) items.push({ productId: line.productId, qty: s.available });
      } else if (fix.action === 'substitute') {
        if (!fix.product) return toast.error(`Choose a substitute for ${line.name}`);
        const s = rows.find((r) => r.productId === line.productId);
        if (s && s.available > 0) items.push({ productId: line.productId, qty: s.available });
        const existing = items.find((i) => i.productId === fix.product?.id);
        if (existing) existing.qty += fix.qty;
        else items.push({ productId: fix.product.id, qty: fix.qty });
      }
    }
    if (items.length === 0) return toast.error('Nothing left on the order. Cancel it instead.');
    setBusy(true);
    try {
      const updated = await update.mutateAsync({ version: order.version, items });
      const confirmed = await transition.mutateAsync({ to: 'confirmed', version: updated.version });
      toast.success(`${confirmed.orderNo} updated and confirmed`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') {
        const again = (err.details as { items?: ShortageItem[] } | undefined)?.items ?? [];
        setLeft(again);
        toast.error('Still short after the changes. Check the list again.');
      } else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={cn('sm:max-w-lg', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Not enough stock to confirm</DialogTitle>
          <DialogDescription>
            Choose what to do with each short item. The customer's total changes; send them the new total on
            WhatsApp after confirming.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3" data-testid="shortage-list">
          {rows.map((s) => {
            const fix = fixes[s.productId] ?? { action: 'remove' };
            const set = (f: Fix) => setFixes((all) => ({ ...all, [s.productId]: f }));
            return (
              <li key={s.productId} className="grid gap-2 rounded-lg border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm whitespace-nowrap tabular-nums">
                    {number(s.requested)} wanted ·{' '}
                    <span className="text-destructive font-medium">{number(s.available)} in stock</span>
                  </p>
                </div>
                <RadioGroup
                  value={fix.action}
                  onValueChange={(v) =>
                    set(
                      v === 'substitute'
                        ? { action: 'substitute', product: null, qty: s.shortBy }
                        : ({ action: v } as Fix),
                    )
                  }
                  className="flex flex-wrap gap-x-4 gap-y-2"
                >
                  {s.available > 0 ? (
                    <label className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value="reduce" /> Reduce to {number(s.available)}
                    </label>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="remove" /> Remove
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="substitute" /> Substitute
                  </label>
                </RadioGroup>
                {fix.action === 'substitute' ? (
                  <div className="grid grid-cols-[1fr_5rem] gap-2">
                    <ProductPicker
                      value={fix.product}
                      placeholder="Substitute product…"
                      excludeIds={[s.productId]}
                      onSelect={(p) => set({ ...fix, product: p })}
                    />
                    <Input
                      aria-label="Substitute quantity"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className="text-center tabular-nums"
                      value={fix.qty}
                      onChange={(e) =>
                        set({ ...fix, qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })
                      }
                    />
                    <p className="text-muted-foreground col-span-2 text-xs">
                      {s.available > 0
                        ? `Keeps the ${number(s.available)} in stock and adds this for the rest. `
                        : 'Replaces this line. '}
                      {fix.product
                        ? `${fix.product.name}: ${number(fix.product.stock)} in stock, ${money(fix.product.netPrice)} each.`
                        : ''}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Back to order
          </Button>
          <Button onClick={() => void apply()} disabled={busy}>
            {busy ? <Spinner /> : null} Update & confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
