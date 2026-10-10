import { Leaf, Package } from 'lucide-react';
import { imageUrl, type ProductDto } from '@sakthimaan/shared';
import { Badge } from '@/components/ui/badge';
import { money, number } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ProductThumb({
  product,
  size = 40,
}: {
  product: Pick<ProductDto, 'images' | 'name'>;
  size?: number;
}) {
  const src = imageUrl(product.images[0], { width: size * 2, height: size * 2, crop: 'fill' });
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-md border object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="bg-muted text-muted-foreground grid shrink-0 place-items-center rounded-md"
      style={{ width: size, height: size }}
    >
      <Package className="size-4" aria-hidden />
    </span>
  );
}

export function StatusBadge({ product }: { product: Pick<ProductDto, 'isActive' | 'isDeleted'> }) {
  if (product.isDeleted) return <Badge variant="destructive">Deleted</Badge>;
  return product.isActive ? (
    <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">Active</Badge>
  ) : (
    <Badge variant="secondary" title="Not on the website. Needs a user who can set prices to activate.">
      Draft
    </Badge>
  );
}

export function GreenBadge() {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
      title="Green cracker"
    >
      <Leaf className="size-3" aria-hidden /> Green
    </span>
  );
}

export function PriceCell({ product }: { product: Pick<ProductDto, 'mrp' | 'discountPct' | 'netPrice'> }) {
  return (
    <div className="text-right tabular-nums">
      <div className="font-medium">{money(product.netPrice)}</div>
      <div className="text-muted-foreground text-xs">
        <s>{money(product.mrp)}</s> · {product.discountPct}% off
      </div>
    </div>
  );
}

/** Red chip for products with nothing in stock. */
export function OutOfStockChip() {
  return (
    <Badge variant="destructive" className="whitespace-nowrap">
      Out of stock
    </Badge>
  );
}

export function StockCell({
  product,
}: {
  product: Pick<ProductDto, 'stock' | 'isLowStock' | 'pendingDemand' | 'unit'>;
}) {
  const short = product.pendingDemand > product.stock;
  return (
    <div className="grid justify-items-end text-right tabular-nums">
      {product.stock === 0 ? (
        <OutOfStockChip />
      ) : (
        <div className={cn('font-medium', product.isLowStock && 'text-amber-600')}>
          {number(product.stock)}
        </div>
      )}
      {product.pendingDemand > 0 ? (
        <div className={cn('text-xs', short ? 'text-destructive' : 'text-muted-foreground')}>
          {number(product.pendingDemand)} on enquiries
        </div>
      ) : product.isLowStock && product.stock > 0 ? (
        <div className="text-xs text-amber-600">Low</div>
      ) : null}
    </div>
  );
}
