import { useEffect, useState, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** Phones: below Tailwind's md breakpoint, where lists switch from tables to cards. */
const PHONE_QUERY = '(max-width: 767.98px)';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useIsPhone = () => useMediaQuery(PHONE_QUERY);

/**
 * List filters. Desktop and tablet: the controls sit inline (laid out by `className`).
 * Phones: a "Filters" button with the active count opens them in a bottom sheet;
 * `search` (if given) stays visible next to the button.
 */
export function FilterBar({
  search,
  active,
  onClear,
  className,
  children,
}: {
  search?: ReactNode;
  /** Number of active filters, not counting the search box. */
  active: number;
  onClear?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);

  if (!phone) {
    return (
      <div className={cn('mb-4 flex flex-wrap items-end gap-2', className)}>
        {search}
        {children}
        {onClear && active > 0 ? (
          <Button variant="ghost" onClick={onClear}>
            <X /> Clear
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-3 flex items-center gap-2">
      {search ? <div className="min-w-0 flex-1">{search}</div> : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" className={cn('shrink-0', !search && 'w-full')}>
            <SlidersHorizontal /> Filters
            {active > 0 ? (
              <Badge className="h-5 min-w-5 rounded-full px-1.5 tabular-nums" aria-label={`${active} active`}>
                {active}
              </Badge>
            ) : null}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85svh] gap-0 rounded-t-2xl p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription className="sr-only">Narrow down the list</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 overflow-y-auto p-4 *:w-full *:min-w-0">
            {children}
          </div>
          <SheetFooter className="flex-row gap-3 border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
            {onClear ? (
              <Button variant="outline" className="flex-1" disabled={active === 0} onClick={onClear}>
                Clear all
              </Button>
            ) : null}
            <Button className="flex-1" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Save / action bar for long forms and detail screens. Sticks to the bottom of the screen on
 * phones and tablets (above the home indicator); sits inline at the end of the form on desktop.
 */
export function StickyActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'bg-background/95 sticky bottom-0 z-20 -mx-3 flex items-center gap-3 border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6',
        'lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:backdrop-blur-none',
        className,
      )}
    >
      {children}
    </div>
  );
}
