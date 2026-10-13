import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_WHATSAPP_MESSAGES,
  WHATSAPP_EVENTS,
  type SeasonDto,
  type SettingsDto,
  type WhatsAppEvent,
} from '@sakthimaan/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Section,
  Spinner,
  TableSkeleton,
} from '@/components/common';
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
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PHONE_SHEET, cn } from '@/lib/utils';
import { useSeasonMutations, useSeasons, useSettings } from './api';
import { ReadOnlyNote, SaveBar, useSaveSection } from './form-bits';
import { SetupChecklist } from './setup-checklist';
import {
  BillingSection,
  CompanySection,
  OrdersSection,
  PaymentsSection,
  StoreSection,
} from './settings-sections';

const TABS = [
  { value: 'company', label: 'Company' },
  { value: 'store', label: 'Store' },
  { value: 'billing', label: 'GST & invoices' },
  { value: 'payments', label: 'Payments' },
  { value: 'orders', label: 'Orders & stock' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'seasons', label: 'Seasons' },
] as const;

/** Store settings, one tab per area. Each form saves its own section with a version check. */
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'company';
  const settings = useSettings();
  const { can } = useAuth();
  const canEdit = can('settings:update');
  const canStore = canEdit || can('cms:manage');
  const s = settings.data;

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          s?.updatedAt
            ? `Last changed ${dateTime(s.updatedAt)}`
            : 'Business details, billing and how the store works.'
        }
      />
      <SetupChecklist setup={s?.setup} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="-mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {settings.isError ? (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        ) : !s ? (
          <TableSkeleton rows={6} cols={2} />
        ) : (
          <>
            {/* key = version: after a save (here or by someone else) each form restarts from the saved values. */}
            <TabsContent value="company">
              <ReadOnlyNote show={!canEdit} />
              <CompanySection key={s.version} s={s} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="store">
              <ReadOnlyNote show={!canStore} />
              <StoreSection key={s.version} s={s} canEdit={canStore} />
            </TabsContent>
            <TabsContent value="billing">
              <ReadOnlyNote show={!canEdit} />
              <BillingSection key={s.version} s={s} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="payments">
              <ReadOnlyNote show={!canEdit} />
              <PaymentsSection key={s.version} s={s} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="orders">
              <ReadOnlyNote show={!canEdit} />
              <OrdersSection key={s.version} s={s} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="whatsapp">
              <ReadOnlyNote show={!canEdit} />
              <WhatsAppSection key={s.version} s={s} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="seasons">
              <SeasonsSection canEdit={canEdit} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </>
  );
}

// ------------------------------------------------------------------ WhatsApp templates

const EVENT_LABEL: Record<WhatsAppEvent, string> = {
  order_received: 'Enquiry received',
  order_confirmed: 'Order confirmed (with payment details)',
  payment_reminder: 'Payment reminder',
  payment_received: 'Payment received',
  order_packed: 'Order packed',
  order_dispatched: 'Order dispatched (with LR number)',
  order_delivered: 'Order delivered',
  order_cancelled: 'Order cancelled',
};

/** Placeholders and the example values used in the preview (store details come from Settings). */
const PLACEHOLDERS: [string, string][] = [
  ['name', 'Ravi'],
  ['orderNo', 'ORD/26-27/000042'],
  ['total', '₹12,840'],
  ['due', '₹6,420'],
  ['upiId', ''],
  ['transport', 'Example Transport'],
  ['lr', 'LR-123456'],
  ['boxes', '3'],
  ['store', ''],
  ['reason', 'Reason: Customer request.'],
];

function WhatsAppSection({ s, canEdit }: { s: SettingsDto; canEdit: boolean }) {
  const [messages, setMessages] = useState<Record<WhatsAppEvent, string>>(
    () =>
      Object.fromEntries(WHATSAPP_EVENTS.map((e) => [e, s.whatsappTemplates[e] ?? ''])) as Record<
        WhatsAppEvent,
        string
      >,
  );
  const [open, setOpen] = useState<WhatsAppEvent | null>(null);
  const { save, errors, saving } = useSaveSection('whatsappTemplates');
  const value = (k: string, example: string) =>
    k === 'upiId'
      ? (s.payment.upiId ?? '[UPI ID not set]')
      : k === 'store'
        ? (s.company.name ?? '[store name not set]')
        : example;
  const preview = (text: string) =>
    PLACEHOLDERS.reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, value(k, v)), text);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(s.version, messages);
      }}
    >
      <fieldset disabled={!canEdit} className="grid min-w-0 gap-4">
        <Section
          title="Messages"
          description="Staff open WhatsApp with these messages filled in and press send. Words in {{double braces}} are filled from the order. An empty message hides that WhatsApp option."
        >
          <p className="text-muted-foreground mb-3 text-xs">
            Available: {PLACEHOLDERS.map(([k]) => `{{${k}}}`).join(' ')}
          </p>
          <ul className="divide-y rounded-lg border">
            {WHATSAPP_EVENTS.map((e) => {
              const empty = !messages[e].trim();
              const expanded = open === e;
              return (
                <li key={e} className="p-3">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-start justify-between gap-3 text-left"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : e)}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        {EVENT_LABEL[e]}
                        {empty ? <Badge variant="outline">Not set</Badge> : null}
                      </span>
                      {!expanded && !empty ? (
                        <span className="text-muted-foreground line-clamp-1 text-sm">{messages[e]}</span>
                      ) : null}
                    </span>
                    <Pencil className="text-muted-foreground mt-1 size-4 shrink-0" aria-hidden />
                  </button>
                  {expanded ? (
                    <div className="mt-3 grid gap-2">
                      <Textarea
                        aria-label={`${EVENT_LABEL[e]} message`}
                        rows={4}
                        value={messages[e]}
                        maxLength={1000}
                        onChange={(ev) => setMessages((m) => ({ ...m, [e]: ev.target.value }))}
                        aria-invalid={!!errors[e]}
                      />
                      {errors[e] ? <p className="text-destructive text-xs">{errors[e]}</p> : null}
                      {!empty ? (
                        <div className="bg-muted/60 rounded-lg p-3 text-sm whitespace-pre-wrap">
                          <span className="text-muted-foreground mb-1 block text-xs">
                            Preview (example order)
                          </span>
                          {preview(messages[e])}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="justify-self-start"
                          onClick={() => setMessages((m) => ({ ...m, [e]: DEFAULT_WHATSAPP_MESSAGES[e] }))}
                        >
                          <RotateCcw /> Use starter text
                        </Button>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
        {canEdit ? <SaveBar saving={saving} /> : null}
      </fieldset>
    </form>
  );
}

// ------------------------------------------------------------------ seasons

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
/** ISO instant → yyyy-mm-dd in IST, for <input type="date">. */
const dateInput = (iso: string) =>
  new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
/** yyyy-mm-dd (IST) → start or end of that day as an ISO instant. */
const istDay = (d: string, end = false) =>
  new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}+05:30`).toISOString();

function SeasonsSection({ canEdit }: { canEdit: boolean }) {
  const seasons = useSeasons();
  const { remove } = useSeasonMutations();
  const [editing, setEditing] = useState<SeasonDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SeasonDto | null>(null);
  return (
    <Section
      title="Sales seasons"
      description="The dashboard compares this season with the last one. Seasons can't overlap."
    >
      {canEdit ? (
        <Button size="sm" className="mb-3" onClick={() => setEditing('new')}>
          <Plus /> Add season
        </Button>
      ) : null}
      {seasons.isError ? (
        <ErrorState error={seasons.error} onRetry={() => void seasons.refetch()} />
      ) : seasons.isPending ? (
        <TableSkeleton rows={3} cols={3} />
      ) : seasons.data.length === 0 ? (
        <EmptyState
          title="No seasons yet"
          description="Add your sales season (for example the weeks around a festival) to compare seasons on the dashboard."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {seasons.data.map((se) => (
            <li key={se.id} className="flex flex-wrap items-center gap-3 p-3">
              <CalendarRange className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {se.name} {se.isCurrent ? <Badge className="ml-1">Current</Badge> : null}
                </p>
                <p className="text-muted-foreground text-sm">
                  {day(se.startDate)} – {day(se.endDate)} · festival {day(se.festivalDate)}
                </p>
              </div>
              {canEdit ? (
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${se.name}`}
                    onClick={() => setEditing(se)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${se.name}`}
                    onClick={() => setDeleting(se)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <SeasonDialog season={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'season'}?`}
        description="Orders are not affected; the dashboard just stops comparing against it."
        confirmLabel="Delete"
        destructive
        onConfirm={() =>
          remove.mutateAsync(deleting?.id ?? '').catch((err: unknown) => {
            toast.error(errorMessage(err));
            throw err;
          })
        }
      />
    </Section>
  );
}

function SeasonDialog({ season, onClose }: { season: SeasonDto | null; onClose: () => void }) {
  const { save } = useSeasonMutations();
  const [f, setF] = useState({
    name: season?.name ?? '',
    startDate: season ? dateInput(season.startDate) : '',
    festivalDate: season ? dateInput(season.festivalDate) : '',
    endDate: season ? dateInput(season.endDate) : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    setErrors({});
    const missing = (['startDate', 'festivalDate', 'endDate'] as const).filter((k) => !f[k]);
    if (missing.length) return setErrors(Object.fromEntries(missing.map((k) => [k, 'Choose a date'])));
    try {
      await save.mutateAsync({
        id: season?.id ?? null,
        body: {
          name: f.name,
          startDate: istDay(f.startDate),
          festivalDate: istDay(f.festivalDate),
          endDate: istDay(f.endDate, true),
        },
      });
      toast.success('Season saved');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length)
        setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{season ? 'Edit season' : 'Add season'}</DialogTitle>
          <DialogDescription>
            Usually from the first enquiries to a week after the festival.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="se-name" error={errors.name} required>
            <Input
              id="se-name"
              value={f.name}
              onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="se-start" error={errors.startDate} required>
              <Input
                id="se-start"
                type="date"
                value={f.startDate}
                onChange={(e) => setF((x) => ({ ...x, startDate: e.target.value }))}
              />
            </Field>
            <Field label="Ends" htmlFor="se-end" error={errors.endDate} required>
              <Input
                id="se-end"
                type="date"
                value={f.endDate}
                onChange={(e) => setF((x) => ({ ...x, endDate: e.target.value }))}
              />
            </Field>
            <Field label="Festival date" htmlFor="se-fest" error={errors.festivalDate} required>
              <Input
                id="se-fest"
                type="date"
                value={f.festivalDate}
                onChange={(e) => setF((x) => ({ ...x, festivalDate: e.target.value }))}
              />
            </Field>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
