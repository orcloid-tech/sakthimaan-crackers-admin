import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useAuth } from '@/hooks/use-auth';
import { useDebounced } from '@/hooks/use-debounced';
import { searchSources } from './search-sources';

/** Open with "/" or Ctrl/⌘+K, except while typing in a field. */
function useShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onOpen();
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

/** Header search across modules the user can read (products now; orders and customers once built). */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const navigate = useNavigate();
  const { can } = useAuth();
  const sources = searchSources.filter((s) => can(...s.permissions));
  useShortcut(() => setOpen(true));

  const results = useQueries({
    queries: sources.map((s) => ({
      queryKey: ['global-search', s.key, q],
      queryFn: ({ signal }: { signal: AbortSignal }) => s.search(q, signal),
      enabled: open && q.length >= 2 && s.matches(q),
      staleTime: 15_000,
    })),
  });
  const loading = results.some((r) => r.isFetching);
  const groups = sources
    .map((s, i) => ({ source: s, items: results[i]?.data ?? [] }))
    .filter((g) => g.items.length > 0);

  const go = (to: string) => {
    setOpen(false);
    setText('');
    navigate(to);
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="text-muted-foreground h-9 w-9 justify-start gap-2 px-0 sm:w-64 sm:px-3"
        aria-label="Search (press / or Ctrl+K)"
      >
        <Search className="mx-auto sm:mx-0" aria-hidden />
        <span className="hidden flex-1 text-left font-normal sm:inline">Search…</span>
        <kbd className="bg-muted hidden rounded px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search products, orders and customers"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={text}
            onValueChange={setText}
            placeholder={sources.map((s) => s.placeholder).join(', ')}
          />
          <CommandList>
            {q.length < 2 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">Type at least 2 characters.</p>
            ) : loading && groups.length === 0 ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : (
              <CommandEmpty>Nothing found for “{q}”.</CommandEmpty>
            )}
            {groups.map(({ source, items }) => (
              <CommandGroup key={source.key} heading={source.label}>
                {items.map((r) => (
                  <CommandItem
                    key={`${source.key}-${r.id}`}
                    value={`${source.key}-${r.id}`}
                    onSelect={() => go(r.to)}
                    className="gap-3"
                  >
                    <source.icon className="text-muted-foreground size-4" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{r.title}</p>
                      {r.subtitle ? (
                        <p className="text-muted-foreground truncate text-xs">{r.subtitle}</p>
                      ) : null}
                    </div>
                    {r.meta ? (
                      <span className="text-muted-foreground text-xs tabular-nums">{r.meta}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
