import { useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, ImageUp, MoreHorizontal, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { HSN_REGEX, imageUrl, type CategoryDto, type CategoryTreeNode } from '@sakthimaan/shared';
import { EmptyState, ErrorState, Field, PageHeader, Spinner, TableSkeleton } from '@/components/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Can } from '@/components/guards';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage } from '@/lib/api';
import { plural } from '@/lib/format';
import { useCategoryMutations, useCategoryTree } from '../catalog/api';
import { useRuntimeSettings } from '../settings/api';

type Editing = { mode: 'create'; parentId: string | null } | { mode: 'edit'; category: CategoryDto };

export function CategoriesPage() {
  const tree = useCategoryTree();
  const m = useCategoryMutations();
  const { can } = useAuth();
  const canManage = can('categories:manage');
  const [editing, setEditing] = useState<Editing | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageTarget, setImageTarget] = useState<CategoryDto | null>(null);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);

  const move = async (siblings: CategoryDto[], index: number, delta: -1 | 1) => {
    const order = [...siblings];
    const [item] = order.splice(index, 1);
    if (!item) return;
    order.splice(index + delta, 0, item);
    try {
      await m.reorder.mutateAsync(order.map((c, i) => ({ id: c.id, sortOrder: (i + 1) * 10 })));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async (c: CategoryDto) => {
    try {
      await m.remove.mutateAsync(c.id);
      toast.success(`Deleted ${c.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const renderRow = (
    c: CategoryDto,
    siblings: CategoryDto[],
    index: number,
    depth: 0 | 1,
    hasChildren: boolean,
  ) => {
    const thumb = imageUrl(c.image, { width: 80, height: 80, crop: 'fill' });
    return (
      <li key={c.id} className={depth ? 'border-t pl-6 sm:pl-12' : ''}>
        <div className="flex items-center gap-3 py-2.5 pr-2">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="size-10 shrink-0 rounded-md border object-cover"
              loading="lazy"
            />
          ) : (
            <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-md">
              <Tags className="size-4" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {c.name}
              {!c.isActive ? <Badge variant="secondary">Hidden</Badge> : null}
              {c.taxRate !== null ? <Badge variant="outline">GST {c.taxRate}%</Badge> : null}
              {c.hsn ? <Badge variant="outline">HSN {c.hsn}</Badge> : null}
            </p>
            <p className="text-muted-foreground text-xs">
              /{c.slug} · {plural(c.productCount, 'product')}
            </p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={index === 0 || m.reorder.isPending}
                onClick={() => void move(siblings, index, -1)}
                aria-label={`Move ${c.name} up`}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={index === siblings.length - 1 || m.reorder.isPending}
                onClick={() => void move(siblings, index, 1)}
                aria-label={`Move ${c.name} down`}
              >
                <ArrowDown />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing({ mode: 'edit', category: c })}>
                    <Pencil className="size-4" aria-hidden /> Edit
                  </DropdownMenuItem>
                  {depth === 0 ? (
                    <DropdownMenuItem onSelect={() => setEditing({ mode: 'create', parentId: c.id })}>
                      <Plus className="size-4" aria-hidden /> Add sub-category
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={() => {
                      setImageTarget(c);
                      fileInput.current?.click();
                    }}
                  >
                    <ImageUp className="size-4" aria-hidden /> {c.image ? 'Change image' : 'Add image'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={c.productCount > 0 || hasChildren}
                    onSelect={() => setDeleting(c)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {c.productCount > 0 || hasChildren ? 'Delete (move its products first)' : 'Delete'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Categories"
        description="Two levels: categories and sub-categories. The order here is the order on the website and price list."
        actions={
          <Can allOf={['categories:manage']}>
            <Button onClick={() => setEditing({ mode: 'create', parentId: null })}>
              <Plus /> New category
            </Button>
          </Can>
        }
      />

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !imageTarget) return;
          toast.promise(m.setImage.mutateAsync({ id: imageTarget.id, file }), {
            loading: 'Uploading image…',
            success: 'Image updated',
            error: (err: unknown) => errorMessage(err),
          });
        }}
      />

      {tree.isPending ? (
        <TableSkeleton rows={6} cols={3} />
      ) : tree.isError ? (
        <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
      ) : tree.data.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create categories like Sparklers, Flower Pots and Rockets to organise products."
        />
      ) : (
        <ul className="bg-card divide-y rounded-xl border px-3">
          {tree.data.map((root: CategoryTreeNode, i) => (
            <li key={root.id}>
              <ul>
                {renderRow(root, tree.data, i, 0, root.children.length > 0)}
                {root.children.map((child, ci) => renderRow(child, root.children, ci, 1, false))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'category'}?`}
        description="The category is removed from the admin and the website."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await remove(deleting);
          setDeleting(null);
        }}
      />

      {editing ? (
        <CategoryDialog editing={editing} roots={tree.data ?? []} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

const formSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(80),
  slug: z
    .string()
    .trim()
    .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens'),
  parentId: z.string(),
  description: z.string().max(1000),
  hsn: z
    .string()
    .trim()
    .refine((v) => v === '' || HSN_REGEX.test(v), 'HSN must be 4, 6 or 8 digits'),
  taxRate: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 28), 'GST % between 0 and 28'),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

function CategoryDialog({
  editing,
  roots,
  onClose,
}: {
  editing: Editing;
  roots: CategoryTreeNode[];
  onClose: () => void;
}) {
  const m = useCategoryMutations();
  const existing = editing.mode === 'edit' ? editing.category : null;
  const hasChildren = existing ? roots.some((r) => r.id === existing.id && r.children.length > 0) : false;
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: existing?.name ?? '',
      slug: existing?.slug ?? '',
      parentId: existing
        ? (existing.parentId ?? 'none')
        : ((editing.mode === 'create' ? editing.parentId : null) ?? 'none'),
      description: existing?.description ?? '',
      hsn: existing?.hsn ?? '',
      taxRate: existing?.taxRate !== null && existing?.taxRate !== undefined ? String(existing.taxRate) : '',
      isActive: existing?.isActive ?? true,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    const body = {
      name: v.name,
      ...(v.slug ? { slug: v.slug } : {}),
      parentId: v.parentId === 'none' ? null : v.parentId,
      description: v.description,
      hsn: v.hsn || null,
      taxRate: v.taxRate === '' ? null : Number(v.taxRate),
      isActive: v.isActive,
    };
    try {
      if (existing) await m.update.mutateAsync({ id: existing.id, body });
      else await m.create.mutateAsync(body);
      toast.success(existing ? 'Category saved' : 'Category created');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        for (const issue of err.issues) {
          const field = issue.path === 'parentId' ? 'parentId' : issue.path;
          if (field in form.getValues()) form.setError(field as keyof FormValues, { message: issue.message });
        }
        if (err.code === 'DUPLICATE') form.setError('slug', { message: 'This slug is already used' });
      }
      toast.error(errorMessage(err));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'New category'}</DialogTitle>
          <DialogDescription>
            GST and HSN set here apply to every product in it that doesn't set its own.
          </DialogDescription>
        </DialogHeader>
        <form id="category-form" onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
          <Field label="Name" htmlFor="cat-name" error={errors.name?.message} required>
            <Input id="cat-name" autoFocus {...form.register('name')} aria-invalid={!!errors.name} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Parent"
              htmlFor="cat-parent"
              hint={hasChildren ? 'Has sub-categories, so it stays top-level' : undefined}
            >
              <Controller
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={hasChildren}>
                    <SelectTrigger id="cat-parent" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (top level)</SelectItem>
                      {roots
                        .filter((r) => r.id !== existing?.id)
                        .map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field
              label="URL slug"
              htmlFor="cat-slug"
              error={errors.slug?.message}
              hint="Leave empty to generate"
            >
              <Input id="cat-slug" {...form.register('slug')} placeholder="flower-pots" />
            </Field>
          </div>
          <Field label="Description" htmlFor="cat-desc" error={errors.description?.message}>
            <Textarea id="cat-desc" rows={2} {...form.register('description')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="HSN override"
              htmlFor="cat-hsn"
              error={errors.hsn?.message}
              hint={<StoreDefaultHint kind="hsn" />}
            >
              <Input id="cat-hsn" inputMode="numeric" {...form.register('hsn')} />
            </Field>
            <Field
              label="GST % override"
              htmlFor="cat-tax"
              error={errors.taxRate?.message}
              hint={<StoreDefaultHint kind="taxRate" />}
            >
              <Input id="cat-tax" inputMode="decimal" {...form.register('taxRate')} />
            </Field>
          </div>
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <span>
                  <span className="font-medium">Visible on the website</span>
                  <span className="text-muted-foreground block text-xs">
                    Hidden categories stay in the admin.
                  </span>
                </span>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            {existing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Empty = store default (…)": the default comes from Settings, and may not be set yet. */
function StoreDefaultHint({ kind }: { kind: 'hsn' | 'taxRate' }) {
  const rt = useRuntimeSettings().data;
  const value = kind === 'hsn' ? rt?.defaultHsn : rt?.defaultTaxRate != null ? `${rt.defaultTaxRate}%` : null;
  return (
    <>{value ? `Empty = store default (${value})` : 'Empty = store default (not set in Settings yet)'}</>
  );
}
