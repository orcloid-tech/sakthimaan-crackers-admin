import { Link } from 'react-router-dom';
import { CircleAlert, ClipboardCheck } from 'lucide-react';
import type { SetupItem, SetupStatus } from '@sakthimaan/shared';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

const BLOCK_TEXT: Record<SetupItem['blocks'], string> = {
  orders: 'Needed to price orders',
  invoices: 'Needed for GST invoices',
  recommended: 'Shown to customers',
};

/**
 * What is still missing in Settings and what it holds up. Shown on the dashboard and the
 * Settings page until everything is filled in; users who can't edit settings are told who can.
 */
export function SetupChecklist({
  setup,
  compact = false,
}: {
  setup: SetupStatus | undefined;
  compact?: boolean;
}) {
  const { can } = useAuth();
  if (!setup || setup.missing.length === 0) return null;
  const canEdit = can('settings:update');
  const canShipping = can('shipping:manage');
  const blocking = setup.missing.filter((m) => m.blocks !== 'recommended');
  return (
    <section
      aria-label="Store setup"
      className={cn(
        'mb-4 rounded-xl border p-4',
        blocking.length ? 'border-amber-500/40 bg-amber-500/5' : 'bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        {blocking.length ? (
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
        ) : (
          <ClipboardCheck className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">
            {blocking.length ? 'Finish setting up the store' : 'A few details are still missing'}
          </h2>
          <p className="text-muted-foreground text-sm">
            {canEdit
              ? 'These come from Settings; nothing is filled in for you.'
              : 'Ask a Super Admin to add these in Settings.'}
          </p>
          <ul className={cn('mt-3 grid gap-1.5 text-sm', !compact && 'sm:grid-cols-2')}>
            {setup.missing.map((m) => (
              <li key={m.key} className="flex flex-wrap items-baseline gap-x-2">
                {(m.tab === 'shipping' ? canShipping : canEdit) ? (
                  <Link
                    to={m.tab === 'shipping' ? '/shipping' : `/settings?tab=${m.tab}`}
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    {m.label}
                  </Link>
                ) : (
                  <span className="font-medium">{m.label}</span>
                )}
                <span className="text-muted-foreground text-xs">{BLOCK_TEXT[m.blocks]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
