import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDto, StockMovementInput } from '@sakthimaan/shared';
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
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { PHONE_SHEET, cn } from '@/lib/utils';
import { useBatches, useProduct, useRecordMovement } from '../catalog/api';
import { ProductPicker } from '../products/product-picker';

type Kind = 'stock_in' | 'stock_out' | 'adjustment';

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'stock_in', label: 'Stock in', hint: 'Received' },
  { value: 'stock_out', label: 'Stock out', hint: 'Damage, sample' },
  { value: 'adjustment', label: 'Set count', hint: 'After counting' },
];

const QUICK_ADD = [10, 25, 50, 100];

/**
 * Records a manual stock movement. Built for one-handed phone use: bottom sheet,
 * large quantity field with the numeric keypad, +/− steppers and quick-add chips.
 * Adjustments send the stockVersion shown, so a concurrent change is caught.
 */
export function StockMovementDialog({
  onClose,
  initialProductId,
  initialKind = 'stock_in',
}: {
  onClose: () => void;
  initialProductId?: string;
  initialKind?: Kind;
}) {
  const [picked, setPicked] = useState<ProductDto | null>(null);
  const initial = useProduct(picked ? undefined : initialProductId);
  const product = picked ?? initial.data ?? null;
  const [kind, setKind] = useState<Kind>(initialKind);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [lot, setLot] = useState('');
  const [batchId, setBatchId] = useState('');
  const record = useRecordMovement();
  const batches = useBatches(product?.id, !!product?.trackBatches);

  const n = qty === '' ? 0 : Number(qty);
  const qtyValid = /^\d+$/.test(qty) && (kind === 'adjustment' ? n >= 0 : n >= 1);
  const needsReason = kind !== 'stock_in';
  const needsLot = kind === 'stock_in' && !!product?.trackBatches;
  const needsBatch = kind === 'adjustment' && !!product?.trackBatches;
  const after = product
    ? kind === 'stock_in'
      ? product.stock + n
      : kind === 'stock_out'
        ? product.stock - n
        : n
    : null;
  const valid =
    !!product &&
    qtyValid &&
    (!needsReason || reason.trim().length >= 3) &&
    (!needsLot || lot.trim() !== '') &&
    (!needsBatch || batchId !== '') &&
    (after === null || after >= 0) &&
    !(kind === 'adjustment' && product.stock === n);

  const step = (delta: number) => setQty(String(Math.max(0, n + delta)));

  const submit = async () => {
    if (!product) return;
    const body: StockMovementInput =
      kind === 'stock_in'
        ? {
            type: 'stock_in',
            productId: product.id,
            qty: n,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(lot.trim() ? { lotNumber: lot.trim() } : {}),
          }
        : kind === 'stock_out'
          ? {
              type: 'stock_out',
              productId: product.id,
              qty: n,
              reason: reason.trim(),
              ...(batchId ? { batchId } : {}),
            }
          : {
              type: 'adjustment',
              productId: product.id,
              newStock: n,
              expectedStockVersion: product.stockVersion,
              reason: reason.trim(),
              ...(batchId ? { batchId } : {}),
            };
    try {
      const r = await record.mutateAsync(body);
      toast.success(`${r.sku}: stock ${r.stockBefore} → ${r.stockAfter}`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('Stock changed while you were counting. Check the new figure and try again.');
        void initial.refetch();
        setPicked(null);
      } else toast.error(errorMessage(err));
    }
  };

  const loadingPreselected = !!initialProductId && !picked && initial.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Record stock</DialogTitle>
          <DialogDescription>Every change is kept in the product's stock ledger.</DialogDescription>
        </DialogHeader>
        <form
          id="movement-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void submit();
          }}
        >
          <Field label="Product" htmlFor="mv-product" required>
            {loadingPreselected ? (
              <Skeleton className="h-11" />
            ) : (
              <ProductPicker id="mv-product" value={product} onSelect={setPicked} />
            )}
          </Field>
          {product ? (
            <p className="text-muted-foreground -mt-2 text-sm">
              In stock now:{' '}
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  product.stock === 0 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {number(product.stock)}
              </span>{' '}
              {product.unit}
              {product.pendingDemand > 0 ? ` · ${number(product.pendingDemand)} on enquiries` : ''}
            </p>
          ) : null}

          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as Kind)}
            className="grid grid-cols-3 gap-2"
          >
            {KINDS.map((k) => (
              <label
                key={k.value}
                className="has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex min-h-14 cursor-pointer flex-col justify-center gap-0.5 rounded-lg border p-2 text-sm"
              >
                <span className="flex items-center gap-1.5">
                  <RadioGroupItem value={k.value} /> <span className="font-medium">{k.label}</span>
                </span>
                <span className="text-muted-foreground text-xs">{k.hint}</span>
              </label>
            ))}
          </RadioGroup>

          <Field
            label={kind === 'adjustment' ? 'Counted quantity' : 'Quantity'}
            htmlFor="mv-qty"
            required
            error={after !== null && after < 0 ? `Only ${product?.stock ?? 0} in stock` : undefined}
            hint={after !== null && qtyValid ? `Stock after: ${number(after)}` : undefined}
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="size-12 shrink-0"
                onClick={() => step(-1)}
                aria-label="One less"
              >
                <Minus />
              </Button>
              <Input
                id="mv-qty"
                // Numeric keypad on phones; focused straight away when the product is preselected.
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                autoComplete="off"
                autoFocus={!!initialProductId}
                className="h-12 text-center text-xl font-semibold tabular-nums"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
              <Button
                type="button"
                variant="outline"
                className="size-12 shrink-0"
                onClick={() => step(1)}
                aria-label="One more"
              >
                <Plus />
              </Button>
            </div>
            {kind !== 'adjustment' ? (
              <div className="mt-2 flex gap-2">
                {QUICK_ADD.map((q) => (
                  <Button
                    key={q}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-9 flex-1"
                    onClick={() => step(q)}
                  >
                    +{q}
                  </Button>
                ))}
              </div>
            ) : null}
          </Field>

          {needsLot ? (
            <Field label="Lot / batch number" htmlFor="mv-lot" required hint="This product tracks batches">
              <Input id="mv-lot" className="h-11" value={lot} onChange={(e) => setLot(e.target.value)} />
            </Field>
          ) : null}
          {product?.trackBatches && kind !== 'stock_in' ? (
            <Field
              label="Batch"
              htmlFor="mv-batch"
              required={needsBatch}
              hint={kind === 'stock_out' ? 'Empty = oldest first' : undefined}
            >
              <Select value={batchId || 'fifo'} onValueChange={(v) => setBatchId(v === 'fifo' ? '' : v)}>
                <SelectTrigger id="mv-batch" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kind === 'stock_out' ? <SelectItem value="fifo">Oldest first (FIFO)</SelectItem> : null}
                  {batches.data?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.lotNumber} · {b.qtyRemaining} left
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Reason" htmlFor="mv-reason" required={needsReason}>
            <Input
              id="mv-reason"
              className="h-11"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                kind === 'stock_in'
                  ? 'Received from factory'
                  : kind === 'stock_out'
                    ? 'Damaged in godown'
                    : 'Physical count'
              }
            />
          </Field>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="movement-form" className="h-11" disabled={!valid || record.isPending}>
            {record.isPending ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
