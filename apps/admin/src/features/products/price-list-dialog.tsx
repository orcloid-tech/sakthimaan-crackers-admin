import { useState } from 'react';
import { toast } from 'sonner';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { openPdf } from '@/lib/download';
import { useCategoryTree } from '../catalog/api';

export function PriceListDialog({ onClose }: { onClose: () => void }) {
  const categories = useCategoryTree();
  const [categoryId, setCategoryId] = useState('all');
  const [includeOutOfStock, setIncludeOutOfStock] = useState(true);
  const [includeCombos, setIncludeCombos] = useState(true);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      await openPdf(
        '/products/price-list.pdf',
        { categoryId: categoryId === 'all' ? undefined : categoryId, includeOutOfStock, includeCombos },
        'price-list.pdf',
      );
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Price list PDF</DialogTitle>
          <DialogDescription>
            Active products, grouped by category, ready to print or share on WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Categories" htmlFor="pl-category">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="pl-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeOutOfStock} onCheckedChange={(c) => setIncludeOutOfStock(c === true)} />
            Include out-of-stock products (marked)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeCombos} onCheckedChange={(c) => setIncludeCombos(c === true)} />
            Include gift boxes
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? <Spinner /> : null}
            Open PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
