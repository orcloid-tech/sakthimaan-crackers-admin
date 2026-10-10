import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import type { BulkPriceInput, BulkPriceResult } from '@sakthimaan/shared';
import { Field, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api';
import { money, plural } from '@/lib/format';
import { useCategoryTree, useProductMutations } from '../catalog/api';

/**
 * Bulk price change in two steps: preview (dry run, shows every product before → after)
 * then apply. The API applies all rows or none (409 if a price changed meanwhile).
 */
export function BulkPriceDialog({
  onClose,
  defaultCategoryId,
}: {
  onClose: () => void;
  defaultCategoryId?: string;
}) {
  const categories = useCategoryTree();
  const { bulkPrice } = useProductMutations();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(defaultCategoryId ? [defaultCategoryId] : []),
  );
  const [mode, setMode] = useState<'set_discount' | 'adjust_mrp'>('set_discount');
  const [value, setValue] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [preview, setPreview] = useState<BulkPriceResult | null>(null);

  const num = Number(value);
  const valid =
    selected.size > 0 &&
    value.trim() !== '' &&
    /^-?\d+(\.\d{1,2})?$/.test(value.trim()) &&
    (mode === 'set_discount' ? num >= 0 && num <= 100 : num >= -90 && num <= 300 && num !== 0);

  const body = (dryRun: boolean): BulkPriceInput => ({
    filter: { categoryIds: [...selected], includeInactive },
    change: mode === 'set_discount' ? { mode, discountPct: num } : { mode, percent: num },
    dryRun,
  });

  const runPreview = async () => {
    try {
      setPreview(await bulkPrice.mutateAsync(body(true)));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const apply = async () => {
    try {
      const r = await bulkPrice.mutateAsync(body(false));
      toast.success(`Updated ${plural(r.changed, 'product')}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
      setPreview(null); // prices moved: preview again
    }
  };

  const toggle = (id: string) => {
    setPreview(null);
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk price change</DialogTitle>
          <DialogDescription>
            Preview the new prices first. Nothing changes until you apply.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Categories</legend>
              <ScrollArea className="h-40 rounded-lg border p-2">
                {categories.data?.map((c) => (
                  <div key={c.id}>
                    <label className="flex items-center gap-2 py-1 text-sm">
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      {c.name} <span className="text-muted-foreground text-xs">({c.productCount})</span>
                    </label>
                    {c.children.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 py-1 pl-6 text-sm">
                        <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                        {s.name} <span className="text-muted-foreground text-xs">({s.productCount})</span>
                      </label>
                    ))}
                  </div>
                ))}
              </ScrollArea>
              <p className="text-muted-foreground text-xs">A category includes its sub-categories.</p>
            </fieldset>

            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as typeof mode);
                setPreview(null);
              }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <label className="has-data-[state=checked]:border-primary flex items-start gap-2 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="set_discount" className="mt-0.5" />
                <span>
                  <span className="font-medium">Set discount %</span>
                  <span className="text-muted-foreground block text-xs">e.g. 80% on all sparklers</span>
                </span>
              </label>
              <label className="has-data-[state=checked]:border-primary flex items-start gap-2 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="adjust_mrp" className="mt-0.5" />
                <span>
                  <span className="font-medium">Change MRP by %</span>
                  <span className="text-muted-foreground block text-xs">
                    e.g. +10 or −5, rounded to whole rupees
                  </span>
                </span>
              </label>
            </RadioGroup>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={mode === 'set_discount' ? 'New discount %' : 'MRP change %'} htmlFor="bulk-value">
                <Input
                  id="bulk-value"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setPreview(null);
                  }}
                  placeholder={mode === 'set_discount' ? '80' : '10'}
                />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox checked={includeInactive} onCheckedChange={(c) => setIncludeInactive(c === true)} />
                Include draft / hidden products
              </label>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm" role="status">
              {preview.changed === 0
                ? `Nothing to change: all ${plural(preview.matched, 'product')} already have this price.`
                : `${plural(preview.changed, 'product')} will change (of ${preview.matched} matched).`}
            </p>
            {preview.changed > 0 ? (
              <ScrollArea className="h-72 rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">MRP</TableHead>
                      <TableHead className="text-right">Disc</TableHead>
                      <TableHead className="text-right">Net price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-muted-foreground font-mono text-xs">{r.sku}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Change from={money(r.before.mrp)} to={money(r.after.mrp)} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Change from={`${r.before.discountPct}%`} to={`${r.after.discountPct}%`} />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          <Change from={money(r.before.netPrice)} to={money(r.after.netPrice)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={bulkPrice.isPending}>
                Back
              </Button>
              <Button onClick={() => void apply()} disabled={bulkPrice.isPending || preview.changed === 0}>
                {bulkPrice.isPending ? <Spinner /> : null}
                Apply to {plural(preview.changed, 'product')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void runPreview()} disabled={!valid || bulkPrice.isPending}>
                {bulkPrice.isPending ? <Spinner /> : null}
                Preview
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Change({ from, to }: { from: string; to: string }) {
  if (from === to) return <span className="text-muted-foreground">{to}</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground line-through">{from}</span>
      <ArrowRight className="size-3" aria-label="becomes" />
      <span>{to}</span>
    </span>
  );
}
