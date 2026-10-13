import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { imageUrl, type ImageRefDto, type ProductDto } from '@sakthimaan/shared';
import { Section, Spinner } from '@/components/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useProductMutations } from '../catalog/api';

const MAX = 8;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export function ProductImages({ product }: { product: ProductDto }) {
  const { can } = useAuth();
  const editable = can('products:update');
  const m = useProductMutations();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<ImageRefDto | null>(null);
  const images = product.images;
  const remaining = MAX - images.length;

  const upload = (files: File[]) => {
    const valid = files.filter((f) => ACCEPT.includes(f.type));
    if (valid.length < files.length) toast.warning('Only JPEG, PNG, WebP or AVIF images can be uploaded');
    if (valid.length === 0) return;
    if (valid.length > remaining) {
      toast.error(`You can add ${remaining} more image${remaining === 1 ? '' : 's'} (max ${MAX})`);
      return;
    }
    toast.promise(m.addImages.mutateAsync({ id: product.id, files: valid }), {
      loading: `Uploading ${valid.length} image${valid.length > 1 ? 's' : ''}…`,
      success: 'Images added',
      error: (err: unknown) => errorMessage(err),
    });
  };

  const reorder = (keys: string[]) =>
    m.reorderImages.mutateAsync({ id: product.id, version: product.version, keys }).catch((err: unknown) => {
      toast.error(errorMessage(err));
    });

  const move = (from: number, to: number) => {
    const keys = images.map((i) => i.key);
    const [k] = keys.splice(from, 1);
    if (k === undefined) return;
    keys.splice(to, 0, k);
    void reorder(keys);
  };

  const busy = m.addImages.isPending || m.reorderImages.isPending || m.removeImage.isPending;

  return (
    <Section
      title="Images"
      description={`Up to ${MAX}. The first image is the cover. Large photos are resized automatically.`}
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map((img, i) => (
          <li key={img.key} className="group bg-muted relative overflow-hidden rounded-lg border">
            <img
              src={imageUrl(img, { width: 320, height: 320, crop: 'fill' }) ?? img.url}
              alt={img.alt ?? product.name}
              className="aspect-square w-full object-cover"
              loading="lazy"
            />
            {i === 0 ? <Badge className="absolute top-1.5 left-1.5">Cover</Badge> : null}
            {editable ? (
              <div className="bg-background/90 absolute inset-x-0 bottom-0 flex justify-between p-1">
                <div className="flex">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={i === 0 || busy}
                    onClick={() => move(i, i - 1)}
                    aria-label="Move left"
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={i === images.length - 1 || busy}
                    onClick={() => move(i, i + 1)}
                    aria-label="Move right"
                  >
                    <ChevronRight />
                  </Button>
                  {i > 0 ? (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => move(i, 0)}
                      aria-label="Make cover image"
                    >
                      <Star />
                    </Button>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => setRemoving(img)}
                  aria-label="Remove image"
                >
                  <Trash2 />
                </Button>
              </div>
            ) : null}
          </li>
        ))}
        {editable && remaining > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                upload([...e.dataTransfer.files]);
              }}
              className={cn(
                'text-muted-foreground hover:border-primary hover:text-foreground focus-visible:ring-ring/50 flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm transition outline-none focus-visible:ring-2',
                dragging && 'border-primary bg-primary/5',
              )}
            >
              {m.addImages.isPending ? (
                <Spinner className="size-5" />
              ) : (
                <ImagePlus className="size-5" aria-hidden />
              )}
              Add images
              <span className="text-xs pointer-coarse:hidden">or drop here</span>
              <span className="hidden text-xs pointer-coarse:inline">Camera or gallery</span>
            </button>
          </li>
        ) : null}
      </ul>
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(',')}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          upload([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this image?"
        description="It is deleted from storage."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await m.removeImage.mutateAsync({ id: product.id, key: removing.key });
            setRemoving(null);
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </Section>
  );
}
