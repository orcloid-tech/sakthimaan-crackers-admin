import { useEffect, useMemo } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, History, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  HSN_REGEX,
  PRODUCT_UNITS,
  SOUND_LEVELS,
  computeNetPrice,
  resolveTaxIfSet,
  splitInclusiveGst,
  type CategoryTreeNode,
  type ProductDto,
} from '@sakthimaan/shared';
import { ErrorState, Field, PageHeader, Section, Spinner } from '@/components/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Can } from '@/components/guards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage } from '@/lib/api';
import { money, parseRupees, rupeesText } from '@/lib/format';
import { useCategoryTree, useProduct, useProductMutations } from '../catalog/api';
import { useRuntimeSettings } from '../settings/api';
import { ProductImages } from './product-images';
import { StatusBadge } from './product-bits';

const intText = (min: number, max: number, label = 'Whole number') =>
  z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max),
      `${label} ${min}–${max}`,
    );

export const productFormSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(150),
  sku: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(/^[A-Za-z0-9][A-Za-z0-9\-_/]{0,39}$/, 'Letters, numbers, - _ / (max 40)'),
  categoryId: z.string().min(1, 'Choose a category'),
  subCategoryId: z.string(),
  unit: z.enum(PRODUCT_UNITS),
  contentsCount: intText(1, 100_000).refine((v) => v !== '', 'Required'),
  description: z.string().max(5000),
  tags: z.string().max(600),
  mrp: z.string().refine((v) => parseRupees(v) !== null, 'Enter the MRP in rupees, e.g. 199 or 199.50'),
  discountPct: z
    .string()
    .trim()
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100, 'Discount 0–100, up to 2 decimals'),
  hsn: z
    .string()
    .trim()
    .refine((v) => v === '' || HSN_REGEX.test(v), 'HSN must be 4, 6 or 8 digits'),
  taxRate: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 28), 'GST % between 0 and 28'),
  openingStock: intText(0, 10_000_000),
  lowStockThreshold: intText(0, 1_000_000),
  isGreen: z.boolean(),
  soundLevel: z.enum(SOUND_LEVELS),
  minAge: intText(0, 21, 'Age'),
  safetyWarning: z.string().max(500),
  videoUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Must start with http:// or https://'),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  sortOrder: intText(0, 1_000_000),
});
export type ProductFormValues = z.infer<typeof productFormSchema>;

export function toFormValues(p: ProductDto | undefined): ProductFormValues {
  return {
    name: p?.name ?? '',
    sku: p?.sku ?? '',
    categoryId: p?.category?.id ?? '',
    subCategoryId: p?.subCategory?.id ?? 'none',
    unit: p?.unit ?? 'box',
    contentsCount: String(p?.contentsCount ?? 1),
    description: p?.description ?? '',
    tags: p?.tags.join(', ') ?? '',
    mrp: rupeesText(p?.mrp),
    discountPct: p ? String(p.discountPct) : '0',
    hsn: p?.hsn ?? '',
    taxRate: p?.taxRate === null || p?.taxRate === undefined ? '' : String(p.taxRate),
    openingStock: '0',
    lowStockThreshold: p ? String(p.lowStockThreshold) : '',
    isGreen: p?.isGreen ?? false,
    soundLevel: p?.soundLevel ?? 'none',
    minAge: p?.minAge === null || p?.minAge === undefined ? '' : String(p.minAge),
    safetyWarning: p?.safetyWarning ?? '',
    videoUrl: p?.videoUrl ?? '',
    isActive: p?.isActive ?? true,
    isFeatured: p?.isFeatured ?? false,
    sortOrder: String(p?.sortOrder ?? 0),
  };
}

export function detailsPayload(v: ProductFormValues) {
  return {
    name: v.name,
    sku: v.sku.toUpperCase(),
    categoryId: v.categoryId,
    subCategoryId: v.subCategoryId === 'none' ? null : v.subCategoryId,
    unit: v.unit,
    contentsCount: Number(v.contentsCount),
    description: v.description,
    tags: v.tags
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean),
    ...(v.lowStockThreshold !== '' ? { lowStockThreshold: Number(v.lowStockThreshold) } : {}),
    isGreen: v.isGreen,
    soundLevel: v.soundLevel,
    minAge: v.minAge === '' ? null : Number(v.minAge),
    safetyWarning: v.safetyWarning,
    videoUrl: v.videoUrl === '' ? null : v.videoUrl,
    isActive: v.isActive,
    isFeatured: v.isFeatured,
    sortOrder: Number(v.sortOrder || '0'),
  };
}

export function pricePayload(v: ProductFormValues) {
  return {
    mrp: parseRupees(v.mrp) ?? 0,
    discountPct: Number(v.discountPct),
    hsn: v.hsn === '' ? null : v.hsn,
    taxRate: v.taxRate === '' ? null : Number(v.taxRate),
  };
}

/** Puts API field errors on the matching inputs. */
export function applyServerErrors(form: UseFormReturn<ProductFormValues>, err: unknown): void {
  if (!(err instanceof ApiError)) return;
  const fields = Object.keys(form.getValues());
  for (const issue of err.issues) {
    const name = issue.path.split('.')[0] ?? '';
    if (fields.includes(name)) form.setError(name as keyof ProductFormValues, { message: issue.message });
  }
  if (err.code === 'DUPLICATE')
    form.setError('sku', { message: 'This SKU is already used by another product' });
}

export function ProductFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const product = useProduct(id);
  if (isEdit && product.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (isEdit && product.isError)
    return <ErrorState error={product.error} onRetry={() => void product.refetch()} />;
  // Gift boxes have their own editor (links from reports and the audit log use /products/:id).
  if (product.data?.type === 'combo') return <Navigate to={`/gift-boxes/${product.data.id}`} replace />;
  return <ProductForm key={product.data?.id ?? 'new'} product={product.data} />;
}

function ProductForm({ product }: { product: ProductDto | undefined }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canPrice = can('products:update_price');
  const canEdit = product ? can('products:update') : can('products:create');
  const m = useProductMutations();
  const categories = useCategoryTree();
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: toFormValues(product),
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;

  // Re-sync when the product changes on the server (after image upload, conflict reload…).
  useEffect(() => {
    if (product && !form.formState.isDirty) form.reset(toFormValues(product));
  }, [product, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (!product) {
        const created = await m.create.mutateAsync({
          ...detailsPayload(v),
          ...pricePayload(v),
          type: 'single',
          openingStock: Number(v.openingStock || '0'),
        });
        toast.success(
          created.isActive
            ? 'Product created'
            : 'Saved as a draft. Someone who can set prices needs to activate it.',
        );
        navigate(`/products/${created.id}`, { replace: true });
        return;
      }
      let version = product.version;
      const detailKeys = Object.keys(dirtyFields).filter(
        (k) => !['mrp', 'discountPct', 'hsn', 'taxRate', 'openingStock'].includes(k),
      );
      if (detailKeys.length > 0) {
        const all = detailsPayload(v) as Record<string, unknown>;
        const changed = Object.fromEntries(
          Object.entries(all).filter(
            ([k]) => detailKeys.includes(k) || (k === 'subCategoryId' && detailKeys.includes('categoryId')),
          ),
        );
        const updated = await m.update.mutateAsync({ id: product.id, body: { version, ...changed } });
        version = updated.version;
      }
      const priceDirty = ['mrp', 'discountPct', 'hsn', 'taxRate'].some((k) => k in dirtyFields);
      if (priceDirty && canPrice) {
        await m.updatePrice.mutateAsync({ id: product.id, body: { version, ...pricePayload(v) } });
      }
      toast.success('Saved');
      form.reset(v);
    } catch (err) {
      applyServerErrors(form, err);
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('Someone else changed this product. Reload to see their changes.', {
          action: { label: 'Reload', onClick: () => form.reset(toFormValues(product)) },
        });
      } else toast.error(errorMessage(err));
    }
  });

  const remove = async () => {
    if (!product) return;
    try {
      await m.remove.mutateAsync(product.id);
      toast.success(`${product.name} deleted`);
      navigate('/products', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const draftLocked = !!product && !product.isActive && !canPrice;
  return (
    <>
      <PageHeader
        back={
          <Link
            to="/products"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" aria-hidden /> Products
          </Link>
        }
        title={product ? product.name : 'New product'}
        description={
          product ? (
            <span className="inline-flex items-center gap-2 font-mono text-xs">
              {product.sku} <StatusBadge product={product} />
            </span>
          ) : undefined
        }
        actions={
          product ? (
            <>
              <Can allOf={['inventory:read']}>
                <Button variant="outline" asChild>
                  <Link to={`/inventory/products/${product.id}`}>
                    <History /> Stock ledger
                  </Link>
                </Button>
              </Can>
              <Can allOf={['products:delete']}>
                <ConfirmDialog
                  trigger={
                    <Button variant="destructive">
                      <Trash2 /> Delete
                    </Button>
                  }
                  title={`Delete ${product.name}?`}
                  description="It disappears from the website and lists. Old orders keep their copy. It can be restored from the Deleted filter."
                  confirmLabel="Delete"
                  destructive
                  onConfirm={remove}
                />
              </Can>
            </>
          ) : null
        }
      />

      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start"
      >
        <fieldset disabled={!canEdit || isSubmitting} className="grid min-w-0 gap-4">
          <BasicsSection form={form} categories={categories.data ?? []} />
          <PricingSection
            form={form}
            categories={categories.data ?? []}
            canPrice={canPrice || !product}
            isEdit={!!product}
          />
          <SafetySection form={form} />
          {product ? <ProductImages product={product} /> : null}
        </fieldset>

        <aside className="grid gap-4 lg:sticky lg:top-20">
          <Section title="Visibility">
            <div className="grid gap-3">
              <Controller
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">Active on website</span>
                      {(!product && !canPrice) || draftLocked ? (
                        <span className="text-muted-foreground flex items-center gap-1 text-xs">
                          <Lock className="size-3" aria-hidden /> Saved as draft until someone who can set
                          prices activates it
                        </span>
                      ) : null}
                    </span>
                    <Switch
                      checked={!product && !canPrice ? false : field.value}
                      onCheckedChange={field.onChange}
                      disabled={(!product && !canPrice) || draftLocked || !canEdit}
                    />
                  </label>
                )}
              />
              <Controller
                control={form.control}
                name="isFeatured"
                render={({ field }) => (
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">Featured</span>
                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
                  </label>
                )}
              />
              <Field
                label="Display order"
                htmlFor="sortOrder"
                error={errors.sortOrder?.message}
                hint="Smaller numbers first"
              >
                <Input
                  id="sortOrder"
                  inputMode="numeric"
                  disabled={!canEdit}
                  {...form.register('sortOrder')}
                />
              </Field>
            </div>
          </Section>
          {canEdit ? (
            <div className="bg-background/95 sticky bottom-0 -mx-3 flex gap-2 border-t p-3 sm:mx-0 sm:rounded-xl sm:border lg:static">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={!form.formState.isDirty || isSubmitting}
                onClick={() => form.reset(toFormValues(product))}
              >
                Discard
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isSubmitting || (!!product && !form.formState.isDirty)}
              >
                {isSubmitting ? <Spinner /> : null}
                {product ? 'Save changes' : 'Create product'}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">You can view this product but not edit it.</p>
          )}
        </aside>
      </form>
    </>
  );
}

function BasicsSection({
  form,
  categories,
}: {
  form: UseFormReturn<ProductFormValues>;
  categories: CategoryTreeNode[];
}) {
  const { errors } = form.formState;
  const categoryId = useWatch({ control: form.control, name: 'categoryId' });
  const subs = categories.find((c) => c.id === categoryId)?.children ?? [];
  return (
    <Section title="Product">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={errors.name?.message} required className="sm:col-span-2">
          <Input id="name" {...form.register('name')} aria-invalid={!!errors.name} />
        </Field>
        <Field
          label="SKU"
          htmlFor="sku"
          error={errors.sku?.message}
          required
          hint="Your product code, e.g. SP-7CM"
        >
          <Input
            id="sku"
            className="font-mono uppercase"
            autoCapitalize="characters"
            {...form.register('sku')}
            aria-invalid={!!errors.sku}
          />
        </Field>
        <Field label="Unit" htmlFor="unit" error={errors.unit?.message} required>
          <Controller
            control={form.control}
            name="unit"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Category" htmlFor="categoryId" error={errors.categoryId?.message} required>
          <Controller
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v) => {
                  field.onChange(v);
                  form.setValue('subCategoryId', 'none', { shouldDirty: true });
                }}
              >
                <SelectTrigger id="categoryId" className="w-full" aria-invalid={!!errors.categoryId}>
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Sub-category" htmlFor="subCategoryId">
          <Controller
            control={form.control}
            name="subCategoryId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={subs.length === 0}>
                <SelectTrigger id="subCategoryId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {subs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Pieces per unit" htmlFor="contentsCount" error={errors.contentsCount?.message} required>
          <Input id="contentsCount" inputMode="numeric" {...form.register('contentsCount')} />
        </Field>
        <Field label="Tags" htmlFor="tags" hint="Comma separated, e.g. kids, night">
          <Input id="tags" {...form.register('tags')} />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          error={errors.description?.message}
          className="sm:col-span-2"
        >
          <Textarea id="description" rows={3} {...form.register('description')} />
        </Field>
      </div>
    </Section>
  );
}

function PricingSection({
  form,
  categories,
  canPrice,
  isEdit,
}: {
  form: UseFormReturn<ProductFormValues>;
  categories: CategoryTreeNode[];
  canPrice: boolean;
  isEdit: boolean;
}) {
  const { errors } = form.formState;
  const [mrpText, discountText, hsn, taxRate, categoryId, subCategoryId] = useWatch({
    control: form.control,
    name: ['mrp', 'discountPct', 'hsn', 'taxRate', 'categoryId', 'subCategoryId'],
  });

  // Live preview with the same shared function and settings (rounding, tax defaults) the API uses.
  const runtime = useRuntimeSettings().data;
  const rounding = runtime?.netPriceRounding;
  // Store defaults from Settings; null when not entered (the preview then says so).
  const defaults = useMemo(
    () => ({ hsn: runtime?.defaultHsn ?? null, taxRate: runtime?.defaultTaxRate ?? null }),
    [runtime?.defaultHsn, runtime?.defaultTaxRate],
  );
  const preview = useMemo(() => {
    const mrp = parseRupees(mrpText);
    const pct = Number(discountText);
    if (mrp === null || !/^\d+(\.\d{1,2})?$/.test(discountText.trim()) || pct > 100) return null;
    try {
      const net = computeNetPrice(mrp, pct, rounding);
      const cat = categories.find((c) => c.id === categoryId);
      const sub = cat?.children.find((s) => s.id === subCategoryId);
      const inherited =
        sub && (sub.hsn !== null || sub.taxRate !== null)
          ? { hsn: sub.hsn ?? cat?.hsn, taxRate: sub.taxRate ?? cat?.taxRate }
          : cat;
      const tax = resolveTaxIfSet(
        { hsn: hsn || null, taxRate: taxRate === '' ? null : Number(taxRate) },
        inherited,
        defaults,
      );
      const split = tax.taxRate === null ? null : splitInclusiveGst(net, tax.taxRate);
      return { mrp, net, saving: mrp - net, tax, split };
    } catch {
      return null;
    }
  }, [mrpText, discountText, hsn, taxRate, categoryId, subCategoryId, categories, rounding, defaults]);

  return (
    <Section
      title="Price & GST"
      description={`Prices include GST. Net price is MRP less discount, ${
        rounding === 'nearest_paisa' ? 'to the paisa' : 'rounded to the rupee'
      } (set in Settings).`}
    >
      {!canPrice ? (
        <p className="text-muted-foreground mb-3 flex items-center gap-1.5 text-sm">
          <Lock className="size-4" aria-hidden /> Price changes need the price permission.
        </p>
      ) : null}
      <fieldset disabled={!canPrice} className="grid gap-4 sm:grid-cols-[1fr_1fr_1.2fr]">
        <Field label="MRP (₹)" htmlFor="mrp" error={errors.mrp?.message} required>
          <Input id="mrp" inputMode="decimal" {...form.register('mrp')} aria-invalid={!!errors.mrp} />
        </Field>
        <Field label="Discount %" htmlFor="discountPct" error={errors.discountPct?.message} required>
          <Input
            id="discountPct"
            inputMode="decimal"
            {...form.register('discountPct')}
            aria-invalid={!!errors.discountPct}
          />
        </Field>
        <div className="bg-muted/60 rounded-lg p-3" aria-live="polite">
          <p className="text-muted-foreground text-xs">Net price</p>
          {preview ? (
            <>
              <p className="text-primary text-2xl font-semibold tabular-nums">{money(preview.net)}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                Saves {money(preview.saving)}
                {preview.split ? ` · GST ${preview.tax.taxRate}% = ${money(preview.split.tax)} incl.` : ''}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-2xl">—</p>
          )}
        </div>
        <Field
          label="HSN"
          htmlFor="hsn"
          error={errors.hsn?.message}
          hint={
            preview?.tax.hsn
              ? `Using ${preview.tax.hsn}`
              : preview
                ? 'Not set here, on the category or in Settings'
                : 'Empty = inherit'
          }
        >
          <Input id="hsn" inputMode="numeric" placeholder="Inherit" {...form.register('hsn')} />
        </Field>
        <Field
          label="GST %"
          htmlFor="taxRate"
          error={errors.taxRate?.message}
          hint={
            preview?.tax.taxRate != null
              ? `Using ${preview.tax.taxRate}%`
              : preview
                ? 'Not set here, on the category or in Settings'
                : 'Empty = inherit'
          }
        >
          <Input id="taxRate" inputMode="decimal" placeholder="Inherit" {...form.register('taxRate')} />
        </Field>
      </fieldset>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {!isEdit ? (
          <Field
            label="Opening stock"
            htmlFor="openingStock"
            error={errors.openingStock?.message}
            hint="Units in hand now"
          >
            <Input id="openingStock" inputMode="numeric" {...form.register('openingStock')} />
          </Field>
        ) : null}
        <Field
          label="Low-stock alert at"
          htmlFor="lowStockThreshold"
          error={errors.lowStockThreshold?.message}
          hint="Empty = store default"
        >
          <Input id="lowStockThreshold" inputMode="numeric" {...form.register('lowStockThreshold')} />
        </Field>
      </div>
    </Section>
  );
}

function SafetySection({ form }: { form: UseFormReturn<ProductFormValues> }) {
  const { errors } = form.formState;
  return (
    <Section title="Safety & media">
      <div className="grid gap-4 sm:grid-cols-3">
        <Controller
          control={form.control}
          name="isGreen"
          render={({ field }) => (
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-3">
              <span>
                <span className="font-medium">Green cracker</span>
                <span className="text-muted-foreground block text-xs">
                  Reduced-emission product (shown on the website and price list)
                </span>
              </span>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </label>
          )}
        />
        <Field label="Sound level" htmlFor="soundLevel">
          <Controller
            control={form.control}
            name="soundLevel"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="soundLevel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOUND_LEVELS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Minimum age" htmlFor="minAge" error={errors.minAge?.message}>
          <Input id="minAge" inputMode="numeric" {...form.register('minAge')} />
        </Field>
        <Field label="Video link" htmlFor="videoUrl" error={errors.videoUrl?.message}>
          <Input id="videoUrl" type="url" placeholder="https://" {...form.register('videoUrl')} />
        </Field>
        <Field
          label="Safety warning"
          htmlFor="safetyWarning"
          error={errors.safetyWarning?.message}
          className="sm:col-span-3"
        >
          <Input
            id="safetyWarning"
            placeholder="e.g. Light on flat ground and step back"
            {...form.register('safetyWarning')}
          />
        </Field>
      </div>
    </Section>
  );
}
