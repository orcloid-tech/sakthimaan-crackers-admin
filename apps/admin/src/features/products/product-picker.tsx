import { useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import type { ProductDto } from '@sakthimaan/shared';
import { Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounced } from '@/hooks/use-debounced';
import { money, number } from '@/lib/format';
import { useProducts } from '../catalog/api';
import { ProductThumb } from './product-bits';

/** Searchable product selector (server-side search, 20 results). */
export function ProductPicker({
  value,
  onSelect,
  type,
  placeholder = 'Search product…',
  excludeIds = [],
  id,
}: {
  value: ProductDto | null;
  onSelect: (p: ProductDto) => void;
  type?: 'single' | 'combo';
  placeholder?: string;
  excludeIds?: string[];
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const results = useProducts({ q: q || undefined, type, pageSize: 20, sort: 'name' });
  const items = (results.data?.data ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {value ? (
              `${value.name} (${value.sku})`
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Name or SKU" />
          <CommandList>
            {results.isFetching && items.length === 0 ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : null}
            <CommandEmpty>No products found.</CommandEmpty>
            <CommandGroup>
              {items.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onSelect(p);
                    setOpen(false);
                    setSearch('');
                  }}
                  className="gap-3"
                >
                  <ProductThumb product={p} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{p.name}</p>
                    <p className="text-muted-foreground font-mono text-xs">{p.sku}</p>
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <p>{money(p.netPrice)}</p>
                    <p className="text-muted-foreground">Stock {number(p.stock)}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
