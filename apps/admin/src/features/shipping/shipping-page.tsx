import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin, Pencil, Plus, Search, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import {
  INDIAN_STATES,
  type CityDto,
  type DeliveryChargeType,
  type IndianStateCode,
  type ServiceStateDto,
  type TransportPartnerDto,
  type ZoneDto,
} from '@sakthimaan/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState, ErrorState, Field, PageHeader, Spinner, TableSkeleton } from '@/components/common';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, errorMessage } from '@/lib/api';
import { money, parseRupees, rupeesText } from '@/lib/format';
import { PHONE_SHEET, cn } from '@/lib/utils';
import {
  useCities,
  usePartners,
  useRuntimeSettings,
  useShippingMutations,
  useStates,
  useZones,
  type ZoneBody,
} from '../settings/api';

const NONE = '__none__';
const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
const issuesOf = (err: unknown) =>
  err instanceof ApiError ? Object.fromEntries(err.issues.map((i) => [i.path, i.message])) : {};

/** Where we deliver: states, zones, city exceptions, transport partners. */
export function ShippingPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'states';
  const canManage = useAuth().can('shipping:manage');
  return (
    <>
      <PageHeader
        title="Delivery & zones"
        description="Which states and cities you deliver to, minimum order values and delivery charges. Changes apply to the next order."
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="states">States</TabsTrigger>
            <TabsTrigger value="zones">Zones</TabsTrigger>
            <TabsTrigger value="cities">City exceptions</TabsTrigger>
            <TabsTrigger value="transport">Transport</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="states">
          <StatesTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="zones">
          <ZonesTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="cities">
          <CitiesTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="transport">
          <TransportTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ZoneSelect({
  id,
  value,
  onChange,
  zones,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  zones: ZoneDto[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose zone" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No zone</SelectItem>
        {zones.map((z) => (
          <SelectItem key={z.id} value={z.id}>
            {z.name}
            {z.isActive ? '' : ' (inactive)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ------------------------------------------------------------------ states

function StatesTab({ canManage }: { canManage: boolean }) {
  const states = useStates();
  const zones = useZones();
  const { updateStates } = useShippingMutations();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'on' | 'off'>('all');
  const [selected, setSelected] = useState<Set<IndianStateCode>>(new Set());
  const [editing, setEditing] = useState<ServiceStateDto | null>(null);

  const rows = useMemo(
    () =>
      (states.data ?? []).filter(
        (s) =>
          (show === 'all' || (show === 'on' ? s.isServiceable : !s.isServiceable)) &&
          (!q || s.name.toLowerCase().includes(q.toLowerCase()) || s.code.toLowerCase() === q.toLowerCase()),
      ),
    [states.data, q, show],
  );
  const apply = (body: Parameters<typeof updateStates.mutateAsync>[0], ok: string) =>
    updateStates
      .mutateAsync(body)
      .then(() => {
        toast.success(ok);
        setSelected(new Set());
      })
      .catch((err: unknown) => toast.error(errorMessage(err)));
  const toggle = (code: IndianStateCode) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const serviceableCount = (states.data ?? []).filter((s) => s.isServiceable).length;

  if (states.isError) return <ErrorState error={states.error} onRetry={() => void states.refetch()} />;
  if (states.isPending) return <TableSkeleton rows={10} cols={4} />;

  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">
        Delivering to {serviceableCount} of {states.data.length} states and union territories.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            aria-label="Search states"
            placeholder="Search state"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={show} onValueChange={(v) => setShow(v as typeof show)}>
          <SelectTrigger className="w-44" aria-label="Show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="on">Delivering</SelectItem>
            <SelectItem value="off">Not delivering</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {canManage && selected.size > 0 ? (
        <div className="bg-background border-primary/40 sticky top-16 z-10 shadow-sm flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
          <span className="px-1 font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            onClick={() => void apply({ codes: [...selected], isServiceable: true }, 'Delivery switched on')}
          >
            Deliver
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void apply({ codes: [...selected], isServiceable: false }, 'Delivery switched off')
            }
          >
            Stop delivering
          </Button>
          <Select
            value=""
            onValueChange={(v) =>
              void apply({ codes: [...selected], zoneId: v === NONE ? null : v }, 'Zone assigned')
            }
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Move to zone">
              <SelectValue placeholder="Move to zone…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No zone</SelectItem>
              {(zones.data ?? []).map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <ul className="divide-y rounded-xl border">
        {rows.map((s) => (
          <li key={s.code} className="flex items-center gap-3 px-3 py-2.5">
            {canManage ? (
              <Checkbox
                checked={selected.has(s.code)}
                onCheckedChange={() => toggle(s.code)}
                aria-label={`Select ${s.name}`}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.name} <span className="text-muted-foreground text-xs font-normal">{s.gstCode}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                {s.zoneName ?? 'No zone'} · min {money(s.effectiveMinOrderValue)}
                {s.minOrderValue !== null ? ' (state override)' : ''}
                {s.cityExceptions ? ` · ${s.cityExceptions} city exception(s)` : ''}
              </p>
              {!s.isServiceable && s.restrictionNote ? (
                <p className="text-muted-foreground truncate text-xs italic">“{s.restrictionNote}”</p>
              ) : null}
            </div>
            <Switch
              checked={s.isServiceable}
              disabled={!canManage || updateStates.isPending}
              aria-label={`Deliver to ${s.name}`}
              onCheckedChange={(v) =>
                void apply(
                  { codes: [s.code], isServiceable: v },
                  v ? `Delivering to ${s.name}` : `Stopped delivering to ${s.name}`,
                )
              }
            />
            {canManage ? (
              <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                <Pencil />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? (
        <StateDialog state={editing} zones={zones.data ?? []} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function StateDialog({
  state,
  zones,
  onClose,
}: {
  state: ServiceStateDto;
  zones: ZoneDto[];
  onClose: () => void;
}) {
  const { updateStates } = useShippingMutations();
  const [f, setF] = useState({
    isServiceable: state.isServiceable,
    zoneId: state.zoneId ?? NONE,
    min: state.minOrderValue === null ? '' : rupeesText(state.minOrderValue),
    note: state.restrictionNote ?? '',
  });
  const [error, setError] = useState('');
  const save = async () => {
    const min = f.min.trim() ? parseRupees(f.min) : null;
    if (f.min.trim() && min === null) return setError('Enter an amount or leave blank');
    try {
      await updateStates.mutateAsync({
        codes: [state.code],
        isServiceable: f.isServiceable,
        zoneId: f.zoneId === NONE ? null : f.zoneId,
        minOrderValue: min,
        restrictionNote: f.note.trim() || null,
      });
      toast.success(`${state.name} updated`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const zoneMin = zones.find((z) => z.id === f.zoneId)?.minOrderValue;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{state.name}</DialogTitle>
          <DialogDescription>GST state code {state.gstCode}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span className="font-medium">We deliver here</span>
            <Switch
              checked={f.isServiceable}
              onCheckedChange={(v) => setF((x) => ({ ...x, isServiceable: v }))}
            />
          </label>
          <Field label="Zone" htmlFor="st-zone" hint="The zone sets the minimum order and delivery charges">
            <ZoneSelect
              id="st-zone"
              value={f.zoneId}
              zones={zones}
              onChange={(v) => setF((x) => ({ ...x, zoneId: v }))}
            />
          </Field>
          <Field
            label="Minimum order for this state (₹)"
            htmlFor="st-min"
            error={error}
            hint={`Leave blank to use the zone's ${zoneMin !== undefined ? money(zoneMin) : 'or store default'}`}
          >
            <Input
              id="st-min"
              inputMode="decimal"
              value={f.min}
              onChange={(e) => setF((x) => ({ ...x, min: e.target.value }))}
            />
          </Field>
          <Field label="Message when we don't deliver" htmlFor="st-note">
            <Textarea
              id="st-note"
              rows={2}
              value={f.note}
              placeholder="Crackers can't be sent to this state by road transport."
              onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))}
            />
          </Field>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={updateStates.isPending}>
            {updateStates.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ zones

const RULE_LABEL: Record<DeliveryChargeType, string> = {
  flat: 'Flat ₹',
  percent: '% of subtotal',
  free: 'Free',
};

function ruleText(r: ZoneDto['deliveryRules'][number]) {
  const band = `${money(r.minOrderValue)}${r.maxOrderValue !== null ? ` – ${money(r.maxOrderValue)}` : '+'}`;
  const charge = r.type === 'free' ? 'free' : r.type === 'flat' ? money(r.value) : `${r.value}%`;
  return `${band}: ${charge}`;
}

function ZonesTab({ canManage }: { canManage: boolean }) {
  const zones = useZones();
  const { removeZone } = useShippingMutations();
  const [editing, setEditing] = useState<ZoneDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ZoneDto | null>(null);
  if (zones.isError) return <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />;
  if (zones.isPending) return <TableSkeleton rows={4} cols={3} />;
  return (
    <div className="grid gap-3">
      {canManage ? (
        <Button className="justify-self-start" onClick={() => setEditing('new')}>
          <Plus /> Add zone
        </Button>
      ) : null}
      {zones.data.length === 0 ? (
        <EmptyState
          title="No zones yet"
          description="Group states that share a minimum order and delivery terms."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {zones.data.map((z) => (
            <article key={z.id} className={cn('bg-card rounded-xl border p-4', !z.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">
                    {z.name} {z.isActive ? null : <Badge variant="secondary">Inactive</Badge>}
                  </h3>
                  {z.description ? <p className="text-muted-foreground text-sm">{z.description}</p> : null}
                </div>
                {canManage ? (
                  <div className="flex">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${z.name}`}
                      onClick={() => setEditing(z)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${z.name}`}
                      onClick={() => setDeleting(z)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Minimum order</dt>
                <dd className="font-medium">{money(z.minOrderValue)}</dd>
                <dt className="text-muted-foreground">Delivery</dt>
                <dd>
                  {z.deliveryChargeMode === 'to_pay'
                    ? 'Customer pays at the transport office'
                    : z.deliveryRules.length
                      ? z.deliveryRules.map(ruleText).join(' · ')
                      : 'Prepaid, no charge set'}
                </dd>
                {z.estimatedDeliveryDays ? (
                  <>
                    <dt className="text-muted-foreground">Delivery time</dt>
                    <dd>
                      {z.estimatedDeliveryDays.min}–{z.estimatedDeliveryDays.max} days
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">States</dt>
                <dd>
                  {z.stateCodes.length
                    ? z.stateCodes.map(stateName).join(', ')
                    : 'None yet (assign on the States tab)'}
                </dd>
              </dl>
            </article>
          ))}
        </div>
      )}
      {editing ? (
        <ZoneDialog zone={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'zone'}?`}
        description="Only a zone with no states can be deleted. To pause it, edit it and switch it off instead."
        confirmLabel="Delete"
        destructive
        onConfirm={() =>
          removeZone.mutateAsync(deleting?.id ?? '').catch((err: unknown) => {
            toast.error(errorMessage(err));
            throw err;
          })
        }
      />
    </div>
  );
}

interface RuleDraft {
  from: string;
  to: string;
  type: DeliveryChargeType;
  value: string;
}

function ZoneDialog({ zone, onClose }: { zone: ZoneDto | null; onClose: () => void }) {
  const { saveZone } = useShippingMutations();
  const [f, setF] = useState({
    name: zone?.name ?? '',
    description: zone?.description ?? '',
    min: zone ? rupeesText(zone.minOrderValue) : '',
    mode: zone?.deliveryChargeMode ?? 'to_pay',
    daysMin: zone?.estimatedDeliveryDays ? String(zone.estimatedDeliveryDays.min) : '',
    daysMax: zone?.estimatedDeliveryDays ? String(zone.estimatedDeliveryDays.max) : '',
    sortOrder: String(zone?.sortOrder ?? 0),
    isActive: zone?.isActive ?? true,
  });
  const [rules, setRules] = useState<RuleDraft[]>(
    (zone?.deliveryRules ?? []).map((r) => ({
      from: rupeesText(r.minOrderValue),
      to: r.maxOrderValue === null ? '' : rupeesText(r.maxOrderValue),
      type: r.type,
      value: r.type === 'flat' ? rupeesText(r.value) : String(r.value),
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setErrors({});
    const min = parseRupees(f.min);
    if (min === null) return setErrors({ minOrderValue: 'Enter an amount' });
    const body: ZoneBody = {
      name: f.name,
      description: f.description.trim() || undefined,
      minOrderValue: min,
      deliveryChargeMode: f.mode,
      deliveryRules:
        f.mode === 'prepaid'
          ? rules.map((r) => ({
              minOrderValue: parseRupees(r.from || '0') ?? 0,
              maxOrderValue: r.to.trim() ? (parseRupees(r.to) ?? undefined) : undefined,
              type: r.type,
              value: r.type === 'flat' ? (parseRupees(r.value || '0') ?? 0) : Number(r.value || 0),
            }))
          : [],
      estimatedDeliveryDays:
        f.daysMin && f.daysMax ? { min: Number(f.daysMin), max: Number(f.daysMax) } : undefined,
      sortOrder: Number(f.sortOrder || 0),
      isActive: f.isActive,
    };
    try {
      await saveZone.mutateAsync({ id: zone?.id ?? null, body });
      toast.success('Zone saved');
      onClose();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-lg', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{zone ? `Edit ${zone.name}` : 'Add zone'}</DialogTitle>
          <DialogDescription>States in a zone share its minimum order and delivery terms.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="z-name" error={errors.name} required>
              <Input
                id="z-name"
                value={f.name}
                placeholder="South India"
                onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
              />
            </Field>
            <Field label="Minimum order (₹)" htmlFor="z-min" error={errors.minOrderValue} required>
              <Input
                id="z-min"
                inputMode="decimal"
                value={f.min}
                onChange={(e) => setF((x) => ({ ...x, min: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="z-desc">
            <Input
              id="z-desc"
              value={f.description}
              onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))}
            />
          </Field>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Delivery charges</span>
            <RadioGroup
              value={f.mode}
              onValueChange={(v) => setF((x) => ({ ...x, mode: v as typeof f.mode }))}
              className="grid gap-2 sm:grid-cols-2"
            >
              <label className="has-data-[state=checked]:border-primary flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="to_pay" className="mt-0.5" /> To pay: customer pays at the transport
                office
              </label>
              <label className="has-data-[state=checked]:border-primary flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="prepaid" className="mt-0.5" /> Prepaid: added to the bill
              </label>
            </RadioGroup>
          </div>
          {f.mode === 'prepaid' ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Charge by order value</span>
              <p className="text-muted-foreground text-xs">
                The first band that matches the subtotal is used.
              </p>
              {rules.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr_8rem_6rem_auto]"
                >
                  <Field label="From ₹" htmlFor={`r-from-${i}`}>
                    <Input
                      id={`r-from-${i}`}
                      inputMode="decimal"
                      value={r.from}
                      onChange={(e) =>
                        setRules((rs) => rs.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                      }
                    />
                  </Field>
                  <Field
                    label="Below ₹"
                    htmlFor={`r-to-${i}`}
                    error={errors[`deliveryRules.${i}.maxOrderValue`]}
                  >
                    <Input
                      id={`r-to-${i}`}
                      inputMode="decimal"
                      placeholder="no limit"
                      value={r.to}
                      onChange={(e) =>
                        setRules((rs) => rs.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="sm:order-last"
                    aria-label="Remove band"
                    onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                  <Field label="Charge" htmlFor={`r-type-${i}`}>
                    <Select
                      value={r.type}
                      onValueChange={(v) =>
                        setRules((rs) =>
                          rs.map((x, j) => (j === i ? { ...x, type: v as DeliveryChargeType } : x)),
                        )
                      }
                    >
                      <SelectTrigger id={`r-type-${i}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(RULE_LABEL) as DeliveryChargeType[]).map((t) => (
                          <SelectItem key={t} value={t}>
                            {RULE_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {r.type !== 'free' ? (
                    <Field
                      label={r.type === 'flat' ? '₹' : '%'}
                      htmlFor={`r-val-${i}`}
                      error={errors[`deliveryRules.${i}.value`]}
                    >
                      <Input
                        id={`r-val-${i}`}
                        inputMode="decimal"
                        value={r.value}
                        onChange={(e) =>
                          setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                        }
                      />
                    </Field>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              {rules.length < 10 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() =>
                    setRules((rs) => [...rs, { from: rs.at(-1)?.to ?? '0', to: '', type: 'flat', value: '' }])
                  }
                >
                  <Plus /> Add band
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Days (min)" htmlFor="z-dmin">
              <Input
                id="z-dmin"
                inputMode="numeric"
                value={f.daysMin}
                onChange={(e) => setF((x) => ({ ...x, daysMin: e.target.value }))}
              />
            </Field>
            <Field label="Days (max)" htmlFor="z-dmax" error={errors['estimatedDeliveryDays.max']}>
              <Input
                id="z-dmax"
                inputMode="numeric"
                value={f.daysMax}
                onChange={(e) => setF((x) => ({ ...x, daysMax: e.target.value }))}
              />
            </Field>
            <Field label="Order" htmlFor="z-sort" hint="List position">
              <Input
                id="z-sort"
                inputMode="numeric"
                value={f.sortOrder}
                onChange={(e) => setF((x) => ({ ...x, sortOrder: e.target.value }))}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.isActive} onCheckedChange={(v) => setF((x) => ({ ...x, isActive: v }))} />{' '}
            Active
          </label>
          {errors.deliveryRules ? <p className="text-destructive text-sm">{errors.deliveryRules}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saveZone.isPending}>
            {saveZone.isPending ? <Spinner /> : null} Save zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ cities

function CitiesTab({ canManage }: { canManage: boolean }) {
  const [stateCode, setStateCode] = useState<string>('all');
  const runtime = useRuntimeSettings().data;
  const cities = useCities(stateCode === 'all' ? undefined : stateCode);
  const { removeCity } = useShippingMutations();
  const [editing, setEditing] = useState<CityDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CityDto | null>(null);
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">
        Cities not listed follow their state. Add a city to block it (e.g. where crackers are banned) or to
        give it a different minimum order.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={stateCode} onValueChange={setStateCode}>
          <SelectTrigger className="w-56" aria-label="State">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {INDIAN_STATES.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage ? (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add city
          </Button>
        ) : null}
      </div>
      {cities.isError ? (
        <ErrorState error={cities.error} onRetry={() => void cities.refetch()} />
      ) : cities.isPending ? (
        <TableSkeleton rows={4} cols={3} />
      ) : cities.data.length === 0 ? (
        <EmptyState title="No city exceptions" />
      ) : (
        <ul className="divide-y rounded-xl border">
          {cities.data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.name}, {stateName(c.stateCode)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {c.isServiceable ? 'Delivering' : 'Not delivering'}
                  {c.minOrderValue !== null ? ` · min ${money(c.minOrderValue)}` : ''}
                  {c.restrictionNote ? ` · “${c.restrictionNote}”` : ''}
                </p>
              </div>
              {c.isServiceable ? null : <Badge variant="destructive">Blocked</Badge>}
              {canManage ? (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => setEditing(c)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 />
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <CityDialog
          city={editing === 'new' ? null : editing}
          defaultState={
            (stateCode === 'all' ? (runtime?.sellerStateCode ?? '') : stateCode) as IndianStateCode | ''
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove ${deleting?.name ?? 'city'}?`}
        description="The city will follow its state's settings again."
        confirmLabel="Remove"
        destructive
        onConfirm={() =>
          removeCity.mutateAsync(deleting?.id ?? '').catch((err: unknown) => {
            toast.error(errorMessage(err));
            throw err;
          })
        }
      />
    </div>
  );
}

function CityDialog({
  city,
  defaultState,
  onClose,
}: {
  city: CityDto | null;
  defaultState: IndianStateCode | '';
  onClose: () => void;
}) {
  const { saveCity } = useShippingMutations();
  const [f, setF] = useState({
    stateCode: city?.stateCode ?? defaultState,
    name: city?.name ?? '',
    isServiceable: city?.isServiceable ?? false,
    min: city?.minOrderValue != null ? rupeesText(city.minOrderValue) : '',
    note: city?.restrictionNote ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    if (!f.stateCode) return setErrors({ stateCode: 'Choose the state' });
    const min = f.min.trim() ? parseRupees(f.min) : null;
    if (f.min.trim() && min === null) return setErrors({ minOrderValue: 'Enter an amount or leave blank' });
    try {
      await saveCity.mutateAsync({
        id: city?.id ?? null,
        body: {
          stateCode: f.stateCode,
          name: f.name,
          isServiceable: f.isServiceable,
          minOrderValue: min,
          restrictionNote: f.note.trim() || undefined,
        },
      });
      toast.success('City saved');
      onClose();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-md', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{city ? `Edit ${city.name}` : 'Add city exception'}</DialogTitle>
          <DialogDescription>
            Matched against the city the customer types (case and spaces ignored).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="State" htmlFor="ci-state" error={errors.stateCode}>
            <Select
              value={f.stateCode}
              onValueChange={(v) => setF((x) => ({ ...x, stateCode: v as IndianStateCode }))}
            >
              <SelectTrigger id="ci-state" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="City" htmlFor="ci-name" error={errors.name} required>
            <Input
              id="ci-name"
              value={f.name}
              onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
            />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span className="font-medium">We deliver here</span>
            <Switch
              checked={f.isServiceable}
              onCheckedChange={(v) => setF((x) => ({ ...x, isServiceable: v }))}
            />
          </label>
          <Field
            label="Minimum order (₹)"
            htmlFor="ci-min"
            error={errors.minOrderValue}
            hint="Blank = same as the state"
          >
            <Input
              id="ci-min"
              inputMode="decimal"
              value={f.min}
              onChange={(e) => setF((x) => ({ ...x, min: e.target.value }))}
            />
          </Field>
          <Field label="Message shown to customers" htmlFor="ci-note">
            <Textarea
              id="ci-note"
              rows={2}
              value={f.note}
              onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))}
            />
          </Field>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saveCity.isPending}>
            {saveCity.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ transport partners

function TransportTab({ canManage }: { canManage: boolean }) {
  const partners = usePartners();
  const { removePartner } = useShippingMutations();
  const [editing, setEditing] = useState<TransportPartnerDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TransportPartnerDto | null>(null);
  if (partners.isError) return <ErrorState error={partners.error} onRetry={() => void partners.refetch()} />;
  if (partners.isPending) return <TableSkeleton rows={4} cols={3} />;
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">
        Active partners appear in the dispatch dialog. Past orders keep the transport name they were sent
        with.
      </p>
      {canManage ? (
        <Button className="justify-self-start" onClick={() => setEditing('new')}>
          <Plus /> Add transport
        </Button>
      ) : null}
      {partners.data.length === 0 ? (
        <EmptyState title="No transport partners" />
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {partners.data.map((t) => (
              <li key={t.id} className={cn('bg-card rounded-xl border p-3', !t.isActive && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t.name} {t.isActive ? null : <Badge variant="secondary">Inactive</Badge>}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {[t.contactPerson, t.phones.join(', ')].filter(Boolean).join(' · ') || 'No contact'}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t.servedStates.length ? t.servedStates.join(', ') : 'All states'}
                      {t.trackingUrlTemplate ? ' · tracking link' : ''}
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => setEditing(t)}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transport</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>States</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.data.map((t) => (
                  <TableRow key={t.id} className={cn(!t.isActive && 'opacity-60')}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <Truck className="text-muted-foreground size-4" aria-hidden /> {t.name}
                      </span>{' '}
                      {t.isActive ? null : <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.contactPerson ?? ''}
                      <p className="text-muted-foreground text-xs">{t.phones.join(', ')}</p>
                    </TableCell>
                    <TableCell className="max-w-56 text-sm">
                      {t.servedStates.length ? t.servedStates.join(', ') : 'All'}
                    </TableCell>
                    <TableCell className="text-sm">{t.trackingUrlTemplate ? 'Yes' : '—'}</TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${t.name}`}
                            onClick={() => setEditing(t)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Delete ${t.name}`}
                            onClick={() => setDeleting(t)}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {editing ? (
        <PartnerDialog
          partner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={(t) => setDeleting(t)}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'transport'}?`}
        description="Past orders keep the name. To stop using it for now, mark it inactive instead."
        confirmLabel="Delete"
        destructive
        onConfirm={() =>
          removePartner.mutateAsync(deleting?.id ?? '').catch((err: unknown) => {
            toast.error(errorMessage(err));
            throw err;
          })
        }
      />
    </div>
  );
}

function PartnerDialog({
  partner,
  onClose,
  onDelete,
}: {
  partner: TransportPartnerDto | null;
  onClose: () => void;
  onDelete: (t: TransportPartnerDto) => void;
}) {
  const { savePartner } = useShippingMutations();
  const [f, setF] = useState({
    name: partner?.name ?? '',
    contactPerson: partner?.contactPerson ?? '',
    phones: partner?.phones.join(', ') ?? '',
    email: partner?.email ?? '',
    trackingUrlTemplate: partner?.trackingUrlTemplate ?? '',
    notes: partner?.notes ?? '',
    sortOrder: String(partner?.sortOrder ?? 0),
    isActive: partner?.isActive ?? true,
  });
  const [states, setStates] = useState<Set<IndianStateCode>>(new Set(partner?.servedStates ?? []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    try {
      await savePartner.mutateAsync({
        id: partner?.id ?? null,
        body: {
          name: f.name,
          contactPerson: f.contactPerson.trim() || undefined,
          phones: f.phones
            .split(/[,/]/)
            .map((p) => p.trim())
            .filter(Boolean),
          email: f.email.trim() || undefined,
          trackingUrlTemplate: f.trackingUrlTemplate.trim() || undefined,
          servedStates: [...states],
          notes: f.notes.trim() || undefined,
          sortOrder: Number(f.sortOrder || 0),
          isActive: f.isActive,
        },
      });
      toast.success('Transport saved');
      onClose();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-lg', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>{partner ? `Edit ${partner.name}` : 'Add transport'}</DialogTitle>
          <DialogDescription>
            Parcel services and lorry operators you book consignments with.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="tp-name" error={errors.name} required>
              <Input id="tp-name" value={f.name} onChange={set('name')} />
            </Field>
            <Field label="Contact person" htmlFor="tp-contact">
              <Input id="tp-contact" value={f.contactPerson} onChange={set('contactPerson')} />
            </Field>
            <Field
              label="Phones"
              htmlFor="tp-phones"
              error={Object.entries(errors).find(([k]) => k.startsWith('phones'))?.[1]}
              hint="Separate with commas"
            >
              <Input id="tp-phones" inputMode="tel" value={f.phones} onChange={set('phones')} />
            </Field>
            <Field label="Email" htmlFor="tp-email" error={errors.email}>
              <Input id="tp-email" type="email" value={f.email} onChange={set('email')} />
            </Field>
          </div>
          <Field
            label="Tracking link"
            htmlFor="tp-track"
            error={errors.trackingUrlTemplate}
            hint="Put {lr} where the LR number goes, e.g. https://example.com/track?lr={lr}"
          >
            <Input
              id="tp-track"
              type="url"
              value={f.trackingUrlTemplate}
              onChange={set('trackingUrlTemplate')}
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">States served</legend>
            <p className="text-muted-foreground text-xs">
              None ticked = any state. Used to flag unusual choices at dispatch.
            </p>
            <div className="grid max-h-48 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto rounded-lg border p-2 sm:grid-cols-3">
              {INDIAN_STATES.map((s) => (
                <label key={s.code} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={states.has(s.code)}
                    onCheckedChange={(v) =>
                      setStates((cur) => {
                        const n = new Set(cur);
                        if (v === true) n.add(s.code);
                        else n.delete(s.code);
                        return n;
                      })
                    }
                  />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Notes" htmlFor="tp-notes">
            <Textarea id="tp-notes" rows={2} value={f.notes} onChange={set('notes')} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.isActive} onCheckedChange={(v) => setF((x) => ({ ...x, isActive: v }))} />{' '}
              Active
            </label>
            <Field label="List position" htmlFor="tp-sort" className="w-28">
              <Input id="tp-sort" inputMode="numeric" value={f.sortOrder} onChange={set('sortOrder')} />
            </Field>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {partner ? (
            <Button
              variant="ghost"
              className="text-destructive sm:mr-auto"
              onClick={() => {
                onClose();
                onDelete(partner);
              }}
            >
              <Trash2 /> Delete
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={savePartner.isPending}>
            {savePartner.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
