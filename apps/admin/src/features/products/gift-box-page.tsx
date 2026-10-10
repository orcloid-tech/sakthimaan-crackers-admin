import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { computeNetPrice, type ProductDto } from '@sakthimaan/shared';
import { ErrorState, Field, PageHeader, Section, Spinner } from '@/components/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Can } from '@/components/guards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError, errorMessage } from '@/lib/api';
import { money, parseRupees, rupeesText } from '@/lib/format';
import { fetchComboSuggestion, useCategoryTree, useProduct, useProductMutations } from '../catalog/api';
import { ProductThumb, StatusBadge } from './product-bits';
import { ProductPicker } from './product-picker';
import {
  applyServerErrors,
  detailsPayload,
  pricePayload,
  productFormSchema,
  toFormValues,
  type ProductFormValues,
} from './product-form-page';

interface Line {
  productId: string;
  qty: number;
  name: string;
  sku: string;
  netPrice: number;
  mrp: number;
  images: ProductDto['images'];
}

export function GiftBoxPage() {
  const { id } = useParams();
  const box = useProduct(id);
  if (id && box.isPending) return <Skeleton className="h-96" />;
  if (id && box.isError) return <ErrorState error={box.error} onRetry={() => void box.refetch()} />;
  return <GiftBoxBuilder key={box.data?.id ?? 'new'} box={box.data} />;
}

function GiftBoxBuilder({ box }: { box: ProductDto | undefined }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canPrice = can('products:update_price');
  const canEdit = box ? can('products:update') : can('products:create');
  const m = useProductMutations();
  const categories = useCategoryTree();
  const [lines, setLines] = useState<Line[]>(() =>
    (box?.comboItems ?? []).map((c) => ({
      productId: c.productId,
      qty: c.qty,
      name: c.name ?? 'Unknown product',
      sku: c.sku ?? '',
      netPrice: c.netPrice ?? 0,
      mrp: c.mrp ?? 0,
      images: [],
    })),
  );
  const [linesDirty, setLinesDirty] = useState(false);
  const [extra, setExtra] = useState('0');

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      ...toFormValues(box),
      ...(box ? {} : { unit: 'box', contentsCount: '1' }),
      categoryId: box?.category?.id ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  // Pick the "Gift Boxes" category by default for new boxes.
  useEffect(() => {
    if (!box && !form.getValues('categoryId') && categories.data) {
      const gift = categories.data.find((c) => /gift/i.test(c.name));
      if (gift) form.setValue('categoryId', gift.id);
    }
  }, [box, categories.data, form]);

  const suggestionInput = useDebounced(
    { items: lines.map((l) => ({ productId: l.productId, qty: l.qty })), extra },
    300,
  );
  const extraValid = /^\d+(\.\d{1,2})?$/.test(suggestionInput.extra) && Number(suggestionInput.extra) <= 100;
  const suggestion = useQuery({
    queryKey: ['combo-suggestion', suggestionInput],
    queryFn: () =>
      fetchComboSuggestion({ items: suggestionInput.items, extraDiscountPct: Number(suggestionInput.extra) }),
    enabled: suggestionInput.items.length > 0 && extraValid,
  });

  const [mrpText, discountText] = useWatch({ control: form.control, name: ['mrp', 'discountPct'] });
  const mrp = parseRupees(mrpText);
  let net: number | null = null;
  try {
    if (mrp !== null && /^\d+(\.\d{1,2})?$/.test(discountText))
      net = computeNetPrice(mrp, Number(discountText));
  } catch {
    net = null;
  }

  const add = (p: ProductDto) => {
    setLinesDirty(true);
    setLines((ls) =>
      ls.some((l) => l.productId === p.id)
        ? ls.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [
            ...ls,
            {
              productId: p.id,
              qty: 1,
              name: p.name,
              sku: p.sku,
              netPrice: p.netPrice,
              mrp: p.mrp,
              images: p.images,
            },
          ],
    );
  };
  const setQty = (productId: string, qty: number) => {
    setLinesDirty(true);
    setLines((ls) =>
      qty <= 0
        ? ls.filter((l) => l.productId !== productId)
        : ls.map((l) => (l.productId === productId ? { ...l, qty: Math.min(qty, 1000) } : l)),
    );
  };

  const useSuggestion = () => {
    const s = suggestion.data?.suggested;
    if (!s) return;
    form.setValue('mrp', rupeesText(s.mrp), { shouldDirty: true, shouldValidate: true });
    form.setValue('discountPct', String(s.discountPct), { shouldDirty: true, shouldValidate: true });
  };

  const onSubmit = form.handleSubmit(async (v) => {
    if (lines.length === 0) {
      toast.error('Add at least one product to the box');
      return;
    }
    const comboItems = lines.map((l) => ({ productId: l.productId, qty: l.qty }));
    try {
      if (!box) {
        const created = await m.create.mutateAsync({
          ...detailsPayload(v),
          ...pricePayload(v),
          type: 'combo',
          comboItems,
          openingStock: Number(v.openingStock || '0'),
        });
        toast.success(
          created.isActive ? 'Gift box created' : 'Gift box saved as a draft (needs price approval)',
        );
        navigate(`/gift-boxes/${created.id}`, { replace: true });
        return;
      }
      let version = box.version;
      const dirty = Object.keys(form.formState.dirtyFields).filter(
        (k) => !['mrp', 'discountPct', 'hsn', 'taxRate', 'openingStock'].includes(k),
      );
      if (dirty.length > 0 || linesDirty) {
        const all = detailsPayload(v) as Record<string, unknown>;
        const changed = Object.fromEntries(Object.entries(all).filter(([k]) => dirty.includes(k)));
        const updated = await m.update.mutateAsync({
          id: box.id,
          body: { version, ...changed, ...(linesDirty ? { comboItems } : {}) },
        });
        version = updated.version;
      }
      if (canPrice && ['mrp', 'discountPct', 'hsn', 'taxRate'].some((k) => k in form.formState.dirtyFields)) {
        await m.updatePrice.mutateAsync({ id: box.id, body: { version, ...pricePayload(v) } });
      }
      toast.success('Saved');
      setLinesDirty(false);
      form.reset(v);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(
        err instanceof ApiError && err.code === 'VERSION_CONFLICT'
          ? 'Someone else changed this box. Reload the page.'
          : errorMessage(err),
      );
    }
  });

  const s = suggestion.data;
  return (
    <>
      <PageHeader
        back={
          <Link
            to="/gift-boxes"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" aria-hidden /> Gift boxes
          </Link>
        }
        title={box ? box.name : 'Build a gift box'}
        description={
          box ? (
            <span className="inline-flex items-center gap-2 font-mono text-xs">
              {box.sku} <StatusBadge product={box} /> Stock {box.stock}
            </span>
          ) : (
            'Pick the contents, get a suggested price, then save the box with its own stock.'
          )
        }
        actions={
          box ? (
            <Can allOf={['products:delete']}>
              <ConfirmDialog
                trigger={
                  <Button variant="destructive">
                    <Trash2 /> Delete
                  </Button>
                }
                title={`Delete ${box.name}?`}
                description="It disappears from the website and lists. It can be restored later."
                confirmLabel="Delete"
                destructive
                onConfirm={async () => {
                  await m.remove.mutateAsync(box.id).catch((err: unknown) => {
                    toast.error(errorMessage(err));
                    throw err;
                  });
                  navigate('/gift-boxes', { replace: true });
                }}
              />
            </Can>
          ) : null
        }
      />

      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start"
      >
        <fieldset disabled={!canEdit || isSubmitting} className="grid min-w-0 gap-4">
          <Section
            title="Contents"
            description="Single products only. The box keeps its own stock; contents are not deducted."
          >
            <div className="mb-3">
              <ProductPicker
                type="single"
                value={null}
                onSelect={add}
                placeholder="Add a product…"
                excludeIds={[]}
              />
            </div>
            {lines.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                No products yet.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {lines.map((l) => (
                  <li key={l.productId} className="flex items-center gap-3 p-2">
                    <ProductThumb product={{ images: l.images, name: l.name }} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.name}</p>
                      <p className="text-muted-foreground text-xs">
                        <span className="font-mono">{l.sku}</span> · {money(l.netPrice)} each
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => setQty(l.productId, l.qty - 1)}
                        aria-label={`One less ${l.name}`}
                      >
                        <Minus />
                      </Button>
                      <Input
                        className="h-7 w-14 text-center tabular-nums"
                        inputMode="numeric"
                        value={l.qty}
                        aria-label={`Quantity of ${l.name}`}
                        onChange={(e) =>
                          setQty(l.productId, Number(e.target.value.replace(/\D/g, '') || '0'))
                        }
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => setQty(l.productId, l.qty + 1)}
                        aria-label={`One more ${l.name}`}
                      >
                        <Plus />
                      </Button>
                    </div>
                    <p className="w-20 text-right text-sm tabular-nums">{money(l.netPrice * l.qty)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Box details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Name"
                htmlFor="name"
                error={errors.name?.message}
                required
                className="sm:col-span-2"
              >
                <Input id="name" placeholder="Family Gift Box (25 items)" {...form.register('name')} />
              </Field>
              <Field label="SKU" htmlFor="sku" error={errors.sku?.message} required>
                <Input
                  id="sku"
                  className="font-mono uppercase"
                  placeholder="GB-FAMILY"
                  {...form.register('sku')}
                />
              </Field>
              <Field label="Category" htmlFor="categoryId" error={errors.categoryId?.message} required>
                <Controller
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="categoryId" className="w-full">
                        <SelectValue placeholder="Choose…" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.data?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              {!box ? (
                <Field
                  label="Opening stock (boxes)"
                  htmlFor="openingStock"
                  error={errors.openingStock?.message}
                >
                  <Input id="openingStock" inputMode="numeric" {...form.register('openingStock')} />
                </Field>
              ) : null}
              <Controller
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
                    <span>
                      <span className="font-medium">Active on website</span>
                      {!canPrice ? (
                        <span className="text-muted-foreground flex items-center gap-1 text-xs">
                          <Lock className="size-3" aria-hidden /> Needs a user who can set prices to activate
                        </span>
                      ) : null}
                    </span>
                    <Switch
                      checked={!box && !canPrice ? false : field.value}
                      onCheckedChange={field.onChange}
                      disabled={!canPrice && (!box || !box.isActive)}
                    />
                  </label>
                )}
              />
            </div>
          </Section>
        </fieldset>

        <aside className="grid gap-4 lg:sticky lg:top-20">
          <Section title="Price">
            <div className="grid gap-3">
              <dl className="grid grid-cols-2 gap-1 text-sm">
                <dt className="text-muted-foreground">Items' MRP total</dt>
                <dd className="text-right tabular-nums">{s ? money(s.itemsMrpTotal) : '—'}</dd>
                <dt className="text-muted-foreground">Items' net total</dt>
                <dd className="text-right tabular-nums">{s ? money(s.itemsNetTotal) : '—'}</dd>
              </dl>
              <Field label="Extra bundle discount %" htmlFor="extra" hint="On top of the items' own prices">
                <Input
                  id="extra"
                  inputMode="decimal"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  disabled={!canPrice}
                />
              </Field>
              <div className="bg-muted/60 rounded-lg p-3 text-sm" aria-live="polite">
                <p className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Sparkles className="size-3" aria-hidden /> Suggested
                </p>
                {suggestion.isFetching ? (
                  <Spinner />
                ) : s ? (
                  <>
                    <p className="tabular-nums">
                      MRP {money(s.suggested.mrp)} · {s.suggested.discountPct}% off
                    </p>
                    <p className="text-primary text-lg font-semibold tabular-nums">
                      {money(s.suggested.netPrice)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Customer saves {money(s.savingsVsSeparate)} vs buying separately
                    </p>
                    {canPrice || !box ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        onClick={useSuggestion}
                        disabled={!canPrice && !!box}
                      >
                        Use suggestion
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground">Add products to see a price.</p>
                )}
              </div>
              <fieldset disabled={!canPrice && !!box} className="grid grid-cols-2 gap-3">
                <Field label="Box MRP (₹)" htmlFor="mrp" error={errors.mrp?.message} required>
                  <Input id="mrp" inputMode="decimal" {...form.register('mrp')} />
                </Field>
                <Field label="Discount %" htmlFor="discountPct" error={errors.discountPct?.message} required>
                  <Input id="discountPct" inputMode="decimal" {...form.register('discountPct')} />
                </Field>
              </fieldset>
              <p className="text-sm">
                Box price:{' '}
                <span className="text-primary text-lg font-semibold tabular-nums">
                  {net === null ? '—' : money(net)}
                </span>
              </p>
            </div>
          </Section>
          {canEdit ? (
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || (!!box && !form.formState.isDirty && !linesDirty)}
            >
              {isSubmitting ? <Spinner /> : null}
              {box ? 'Save gift box' : 'Create gift box'}
            </Button>
          ) : null}
        </aside>
      </form>
    </>
  );
}
