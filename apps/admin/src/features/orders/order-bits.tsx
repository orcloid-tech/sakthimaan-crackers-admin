import type { ReactNode } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import {
  INDIAN_STATES,
  type IndianStateCode,
  type OrderPricingDto,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ProductDto,
  type ShortageItem,
} from '@sakthimaan/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { money, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ProductPicker } from '../products/product-picker';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  enquiry: 'Enquiry',
  confirmed: 'Confirmed',
  payment_received: 'Paid',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<OrderStatus, string> = {
  enquiry: 'bg-sky-600/15 text-sky-800 dark:text-sky-300',
  confirmed: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  payment_received: 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300',
  packed: 'bg-violet-600/15 text-violet-800 dark:text-violet-300',
  dispatched: 'bg-primary/15 text-primary',
  delivered: 'bg-emerald-700/20 text-emerald-900 dark:text-emerald-200',
  cancelled: 'bg-destructive/10 text-destructive',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge className={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  refunded: 'Refunded',
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const tone =
    status === 'paid'
      ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400'
      : status === 'partial'
        ? 'border-amber-500/50 text-amber-700 dark:text-amber-400'
        : 'text-muted-foreground';
  return (
    <Badge variant="outline" className={tone}>
      {PAYMENT_LABEL[status]}
    </Badge>
  );
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
};

export const stateName = (code: IndianStateCode) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;

// ------------------------------------------------------------------ line editor

/** A line being edited. `product` carries what the editor shows; prices on the order come from the server. */
export interface DraftLine {
  productId: string;
  name: string;
  sku: string;
  netPrice: number;
  stock: number | null;
  qty: number;
}

export const draftFromProduct = (p: ProductDto, qty = 1): DraftLine => ({
  productId: p.id,
  name: p.name,
  sku: p.sku,
  netPrice: p.netPrice,
  stock: p.stock,
  qty,
});

/**
 * Add / remove products and change quantities. Large steppers and the numeric keypad
 * so it works one-handed on a phone. Shortages (from the server preview) are flagged.
 */
export function LineEditor({
  lines,
  onChange,
  shortages = [],
  unavailable = [],
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  shortages?: ShortageItem[];
  unavailable?: { productId: string; reason: string }[];
}) {
  const setQty = (i: number, qty: number) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, qty: Math.max(1, Math.min(10_000, qty)) } : l)));
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i));
  return (
    <div className="grid gap-3">
      {lines.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
          No products yet. Search below to add.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {lines.map((l, i) => {
            const short = shortages.find((s) => s.productId === l.productId);
            const gone = unavailable.find((u) => u.productId === l.productId);
            return (
              <li
                key={l.productId}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3"
                data-testid="order-line"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{l.sku}</span> · {money(l.netPrice)} each
                    {l.stock !== null ? ` · stock ${number(l.stock)}` : ''}
                  </p>
                  {short ? (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Only {number(short.available)} in stock (short by {number(short.shortBy)})
                    </p>
                  ) : null}
                  {gone ? <p className="text-destructive text-xs font-medium">{gone.reason}</p> : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Fewer ${l.name}`}
                    onClick={() => setQty(i, l.qty - 1)}
                    disabled={l.qty <= 1}
                  >
                    <Minus />
                  </Button>
                  <Input
                    aria-label={`Quantity of ${l.name}`}
                    className="h-9 w-16 text-center tabular-nums"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={l.qty}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, ''));
                      if (n > 0) setQty(i, n);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`More ${l.name}`}
                    onClick={() => setQty(i, l.qty + 1)}
                  >
                    <Plus />
                  </Button>
                </div>
                <span className="w-20 text-right font-medium tabular-nums">{money(l.netPrice * l.qty)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => remove(i)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <ProductPicker
        id="add-product"
        value={null}
        placeholder="Add a product…"
        excludeIds={lines.map((l) => l.productId)}
        onSelect={(p) => onChange([...lines, draftFromProduct(p)])}
      />
    </div>
  );
}

// ------------------------------------------------------------------ totals

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-4',
        strong && 'text-base font-semibold',
        muted && 'text-muted-foreground',
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Bill summary. All amounts include GST; the tax split is shown for reference. */
export function TotalsBlock({ pricing }: { pricing: OrderPricingDto }) {
  return (
    <dl className="grid gap-1.5 text-sm">
      <Row label="MRP total" value={money(pricing.mrpTotal)} muted />
      <Row label="Discount" value={`− ${money(pricing.productDiscount)}`} muted />
      <Row label="Subtotal" value={money(pricing.subtotal)} />
      {pricing.couponDiscount > 0 ? (
        <Row label={`Coupon ${pricing.couponCode ?? ''}`} value={`− ${money(pricing.couponDiscount)}`} />
      ) : null}
      {pricing.packingCharge > 0 ? <Row label="Packing" value={money(pricing.packingCharge)} /> : null}
      <Row
        label="Delivery"
        value={
          pricing.deliveryChargeMode === 'to_pay' ? 'To pay at transport' : money(pricing.deliveryCharge)
        }
      />
      {pricing.roundOff !== 0 ? <Row label="Round off" value={money(pricing.roundOff)} muted /> : null}
      <div className="my-1 border-t" />
      <Row label="Total" value={money(pricing.grandTotal)} strong />
      <Row
        label={pricing.isInterState ? 'Includes IGST' : 'Includes CGST + SGST'}
        value={money(pricing.totalTax)}
        muted
      />
    </dl>
  );
}
