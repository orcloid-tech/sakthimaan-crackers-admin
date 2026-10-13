import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ExternalLink, Search } from 'lucide-react';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  type AuditAction,
  type AuditDetail,
  type AuditEntity,
  type AuditListItem,
} from '@sakthimaan/shared';
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FilterBar } from '@/components/responsive';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { dateTime, money } from '@/lib/format';
import { PHONE_SHEET, cn } from '@/lib/utils';
import { useAuditActors, useAuditEntry, useAuditLog } from './api';

const PAGE_SIZE = 30;

export const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  restore: 'Restored',
  status_change: 'Status changed',
  price_change: 'Price changed',
  stock_change: 'Stock changed',
  bulk_update: 'Bulk change',
  import: 'Imported',
  login: 'Signed in',
  login_failed: 'Sign-in failed',
  logout: 'Signed out',
  password_reset: 'Password reset',
  block: 'Blocked',
  unblock: 'Unblocked',
  pack_unpaid: 'Packed before payment',
  credit_change: 'Credit changed',
  issue: 'Issued',
  activate: 'Activated',
};

export const ENTITY_LABEL: Record<AuditEntity, string> = {
  user: 'User',
  product: 'Product',
  category: 'Category',
  stock: 'Stock',
  order: 'Order',
  payment: 'Payment',
  invoice: 'Invoice',
  credit_note: 'Credit note',
  customer: 'Customer',
  coupon: 'Coupon',
  zone: 'Zone',
  state: 'Delivery state',
  city: 'City exception',
  transport_partner: 'Transport',
  banner: 'Banner',
  faq: 'FAQ',
  cms_page: 'Page',
  notification_template: 'Message template',
  season: 'Season',
  settings: 'Settings',
};

const isObjectId = (v: string | null) => !!v && /^[a-f0-9]{24}$/i.test(v);

/** Where the affected record lives in the admin (null if it has no page). */
export function recordLink(e: Pick<AuditListItem, 'entity' | 'entityId' | 'entityLabel'>): string | null {
  const id = e.entityId;
  switch (e.entity) {
    case 'product':
      return isObjectId(id) ? `/products/${id}` : null;
    case 'stock':
      return isObjectId(id) ? `/inventory/products/${id}` : null;
    case 'order':
      return isObjectId(id) ? `/orders/${id}` : null;
    case 'customer':
      return isObjectId(id) ? `/customers/${id}` : null;
    case 'payment':
    case 'invoice':
    case 'credit_note':
      return e.entityLabel ? `/orders?q=${encodeURIComponent(e.entityLabel)}` : null;
    case 'category':
      return '/categories';
    case 'zone':
      return '/shipping?tab=zones';
    case 'state':
      return '/shipping';
    case 'city':
      return '/shipping?tab=cities';
    case 'transport_partner':
      return '/shipping?tab=transport';
    case 'season':
      return '/settings?tab=seasons';
    case 'settings':
      return '/settings';
    default:
      return null;
  }
}

const MONEY_PATH =
  /(^|\.)(mrp|netPrice|amount|grandTotal|minOrderValue|defaultMinOrderValue|deliveryCharge|value|totalSpent)$/i;

/** A stored value as people read it: money in ₹, dates in IST, lists and objects compact. */
function show(path: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number' && MONEY_PATH.test(path)) return money(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dateTime(v);
  if (Array.isArray(v))
    return v.length === 0
      ? '(none)'
      : v.every((x) => typeof x !== 'object')
        ? v.join(', ')
        : JSON.stringify(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return v.toString();
  return JSON.stringify(v);
}

function Who({ e }: { e: AuditListItem }) {
  return e.actor ? (
    <>
      {e.actor.name}
      {e.actor.role ? (
        <span className="text-muted-foreground"> · {e.actor.role.replace('_', ' ')}</span>
      ) : null}
    </>
  ) : (
    <span className="text-muted-foreground">System</span>
  );
}

/** Read-only audit trail: who changed what, when, with before → after for every field. */
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);
  const page = Number(params.get('page') ?? '1') || 1;
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const actors = useAuditActors();
  const list = useAuditLog({
    q: q || undefined,
    userId: get('user') || undefined,
    action: get('action') || undefined,
    entity: get('entity') || undefined,
    entityId: get('entityId') || undefined,
    from: get('from') || undefined,
    to: get('to') || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const [open, setOpen] = useState<string | null>(null);
  const rows = list.data?.data ?? [];
  const filtered = ['user', 'action', 'entity', 'entityId', 'from', 'to'].some((k) => params.get(k)) || !!q;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change made in the admin: who, when and what changed. Entries can't be edited or deleted."
      />
      <FilterBar
        active={
          ['user', 'action', 'entity', 'entityId'].filter((k) => params.get(k)).length +
          (get('from') || get('to') ? 1 : 0)
        }
        onClear={() => {
          setSearch('');
          setParams(new URLSearchParams(), { replace: true });
        }}
        search={
          <div className="relative lg:w-64">
            <Search
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search the audit log"
              placeholder="Record, summary or person"
              className="pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam('q', e.target.value.trim() || null);
              }}
              enterKeyHint="search"
            />
          </div>
        }
      >
        <Select value={get('user') || 'all'} onValueChange={(v) => setParam('user', v)}>
          <SelectTrigger className="w-full md:w-44" aria-label="User">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {(actors.data ?? []).map((a) => (
              <SelectItem key={a.userId} value={a.userId}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={get('entity') || 'all'} onValueChange={(v) => setParam('entity', v)}>
          <SelectTrigger className="w-full md:w-40" aria-label="Record type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All records</SelectItem>
            {AUDIT_ENTITIES.map((e) => (
              <SelectItem key={e} value={e}>
                {ENTITY_LABEL[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={get('action') || 'all'} onValueChange={(v) => setParam('action', v)}>
          <SelectTrigger className="w-full md:w-44" aria-label="Action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {AUDIT_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {ACTION_LABEL[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            className="min-w-0 md:w-40"
            value={get('from')}
            max={get('to') || undefined}
            onChange={(e) => setParam('from', e.target.value)}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            aria-label="To date"
            className="min-w-0 md:w-40"
            value={get('to')}
            min={get('from') || undefined}
            onChange={(e) => setParam('to', e.target.value)}
          />
        </div>
      </FilterBar>
      {get('entityId') ? (
        <p className="text-muted-foreground mb-3 text-sm">Showing the history of one record.</p>
      ) : null}

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'Nothing matches' : 'No changes recorded yet'}
          description={filtered ? 'Try another filter.' : undefined}
        />
      ) : (
        <div className={cn(list.isFetching && 'opacity-70 transition-opacity')}>
          <ul className="grid gap-2 md:hidden">
            {rows.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="bg-card hover:border-primary/50 w-full rounded-xl border p-3 text-left"
                  onClick={() => setOpen(e.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-medium">
                      {ACTION_LABEL[e.action]} · {ENTITY_LABEL[e.entity]}
                    </p>
                    {e.changeCount ? <Badge variant="outline">{e.changeCount} field(s)</Badge> : null}
                  </div>
                  {e.entityLabel ? <p className="truncate font-mono text-sm">{e.entityLabel}</p> : null}
                  {e.summary ? (
                    <p className="text-muted-foreground line-clamp-2 text-sm">{e.summary}</p>
                  ) : null}
                  <p className="text-muted-foreground mt-1 text-xs">
                    <Who e={e} /> · {dateTime(e.at)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpen(e.id)}>
                    <TableCell className="text-sm whitespace-nowrap">{dateTime(e.at)}</TableCell>
                    <TableCell className="text-sm">
                      <Who e={e} />
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{ACTION_LABEL[e.action]}</span>
                      <p className="text-muted-foreground text-xs">{ENTITY_LABEL[e.entity]}</p>
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-sm">
                      {e.entityLabel ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-96 text-sm">
                      <span className="line-clamp-1">
                        {e.summary ?? (e.changeCount ? `${e.changeCount} field(s) changed` : '')}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data?.meta?.total ?? 0}
            onPage={(p) => setParam('page', String(p))}
          />
        </div>
      )}
      {open ? <AuditDialog id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function AuditDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const entry = useAuditEntry(id);
  const e: AuditDetail | undefined = entry.data;
  const link = e ? recordLink(e) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-2xl', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{e ? `${ACTION_LABEL[e.action]} · ${ENTITY_LABEL[e.entity]}` : 'Change'}</DialogTitle>
          <DialogDescription>
            {e ? (
              <>
                <Who e={e} /> · {dateTime(e.at)}
              </>
            ) : (
              'Loading…'
            )}
          </DialogDescription>
        </DialogHeader>
        {entry.isError ? (
          <ErrorState error={entry.error} />
        ) : !e ? (
          <TableSkeleton rows={4} cols={3} />
        ) : (
          <div className="grid min-w-0 gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {e.entityLabel ? <span className="font-mono font-medium">{e.entityLabel}</span> : null}
              {link ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={link} onClick={onClose}>
                    <ExternalLink /> Open {ENTITY_LABEL[e.entity].toLowerCase()}
                  </Link>
                </Button>
              ) : null}
              {e.entityId ? (
                <Button asChild size="sm" variant="ghost">
                  <Link
                    to={`/audit?entity=${e.entity}&entityId=${encodeURIComponent(e.entityId)}`}
                    onClick={onClose}
                  >
                    Full history of this record
                  </Link>
                </Button>
              ) : null}
            </div>
            {e.summary ? <p className="bg-muted rounded-lg p-3 text-sm">{e.summary}</p> : null}
            {e.changes.length ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">Changes</h3>
                <ul className="divide-y rounded-lg border text-sm">
                  {e.changes.map((c) => (
                    <li key={c.path} className="grid gap-1 p-3 sm:grid-cols-[10rem_1fr]">
                      <span className="text-muted-foreground font-mono text-xs break-all">{c.path}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-destructive bg-destructive/5 rounded px-1.5 py-0.5 break-all line-through decoration-1">
                          {show(c.path, c.from)}
                        </span>
                        <ArrowRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                        <span className="rounded bg-emerald-600/10 px-1.5 py-0.5 break-all text-emerald-800 dark:text-emerald-300">
                          {show(c.path, c.to)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No field-level changes were recorded for this action.
              </p>
            )}
            {e.meta && Object.keys(e.meta).length ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">Details</h3>
                <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
                  {Object.entries(e.meta).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground font-mono text-xs">{k}</dt>
                      <dd className="break-all">{show(k, v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            <p className="text-muted-foreground text-xs break-all">
              {[e.ip ? `IP ${e.ip}` : null, e.requestId ? `Request ${e.requestId}` : null, e.userAgent]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
