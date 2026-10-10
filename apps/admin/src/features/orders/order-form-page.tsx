import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { INDIAN_STATES, type IndianStateCode } from '@sakthimaan/shared';
import { Field, PageHeader, Section, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { useCustomerLookup, useOrderMutations, usePricingPreview, type OrderCreateBody } from './api';
import { LineEditor, TotalsBlock, type DraftLine } from './order-bits';

interface FormState {
  phone: string;
  name: string;
  altPhone: string;
  email: string;
  gstin: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  stateCode: IndianStateCode | '';
  pincode: string;
  source: 'phone' | 'whatsapp' | 'admin';
  notes: string;
}

const EMPTY: FormState = {
  phone: '',
  name: '',
  altPhone: '',
  email: '',
  gstin: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  stateCode: 'TN',
  pincode: '',
  source: 'phone',
  notes: '',
};

const opt = (v: string) => (v.trim() ? v.trim() : undefined);

/** Totals, minimum order and serviceability from the server for the current lines. */
export function PreviewPanel({
  stateCode,
  city,
  lines,
  onPreview,
  footer,
}: {
  stateCode: IndianStateCode | '';
  city: string;
  lines: DraftLine[];
  onPreview?: (p: ReturnType<typeof usePricingPreview>['data']) => void;
  footer?: ReactNode;
}) {
  // Debounce a string: a fresh object each render would never settle.
  const key = useDebounced(
    JSON.stringify({
      stateCode,
      city: opt(city),
      items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    }),
    300,
  );
  const preview = usePricingPreview(JSON.parse(key) as Parameters<typeof usePricingPreview>[0]);
  const p = preview.data;
  useEffect(() => onPreview?.(p), [p, onPreview]);
  return (
    <Section title="Bill" description={stateCode ? undefined : 'Choose the state to see totals.'}>
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">Add products to see the total.</p>
      ) : preview.isError ? (
        <p className="text-destructive text-sm">{errorMessage(preview.error)}</p>
      ) : !p ? (
        <div className="grid gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      ) : (
        <div className="grid gap-3" aria-busy={preview.isFetching}>
          <TotalsBlock pricing={p.pricing} />
          {!p.serviceability.serviceable ? (
            <p className="text-destructive flex gap-1.5 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {p.serviceability.reason}
            </p>
          ) : null}
          {!p.meetsMinimum ? (
            <p className="flex gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Below the {money(p.serviceability.minOrderValue)} minimum for this area (allowed for staff
              orders).
            </p>
          ) : null}
          {p.serviceability.zoneName ? (
            <p className="text-muted-foreground text-xs">
              Zone: {p.serviceability.zoneName}
              {p.serviceability.estimatedDays
                ? ` · ${p.serviceability.estimatedDays.min}–${p.serviceability.estimatedDays.max} days`
                : ''}
            </p>
          ) : null}
        </div>
      )}
      {footer}
    </Section>
  );
}

/** Order taken over the phone or WhatsApp. Starts as an enquiry; confirm it from the order page. */
export function OrderFormPage() {
  const navigate = useNavigate();
  const [f, setF] = useState<FormState>(EMPTY);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ReturnType<typeof usePricingPreview>['data']>();
  const lookup = useCustomerLookup(f.phone);
  const known = lookup.data;
  const { create } = useOrderMutations();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  // Returning customer: fill blanks from their record and last address (once per customer,
  // adjusted during render rather than in an effect).
  const [filledFor, setFilledFor] = useState<string | null>(null);
  if (known && known.id !== filledFor) {
    setFilledFor(known.id);
    const a = known.addresses[0];
    setF((s) => ({
      ...s,
      name: s.name || known.name,
      altPhone: s.altPhone || (known.altPhone ?? ''),
      email: s.email || (known.email ?? ''),
      gstin: s.gstin || (known.gstin ?? ''),
      ...(a && !s.line1
        ? {
            line1: a.line1,
            line2: a.line2 ?? '',
            landmark: a.landmark ?? '',
            city: a.city,
            stateCode: a.stateCode,
            pincode: a.pincode,
          }
        : {}),
    }));
  }

  const submit = async () => {
    setErrors({});
    if (!f.stateCode) return setErrors({ 'address.stateCode': 'Choose a state' });
    const body: OrderCreateBody = {
      customer: {
        name: f.name.trim(),
        phone: f.phone,
        altPhone: opt(f.altPhone),
        email: opt(f.email),
        gstin: opt(f.gstin),
      },
      address: {
        line1: f.line1.trim(),
        line2: opt(f.line2),
        landmark: opt(f.landmark),
        city: f.city.trim(),
        stateCode: f.stateCode,
        pincode: f.pincode.trim(),
      },
      items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      source: f.source,
      notes: opt(f.notes),
    };
    try {
      const order = await create.mutateAsync(body);
      toast.success(`Enquiry ${order.orderNo} created`);
      navigate(`/orders/${order.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
        toast.error('Check the highlighted fields');
      } else toast.error(errorMessage(err));
    }
  };

  const fieldErr = (k: string) => errors[k];
  const input = (
    k: keyof FormState,
    path: string,
    label: string,
    props: Partial<React.ComponentProps<typeof Input>> = {},
    required = false,
  ) => (
    <Field label={label} htmlFor={`f-${k}`} error={fieldErr(path)} required={required}>
      <Input
        id={`f-${k}`}
        value={f[k]}
        onChange={(e) => set(k, e.target.value as never)}
        aria-invalid={!!fieldErr(path)}
        {...props}
      />
    </Field>
  );

  return (
    <>
      <PageHeader
        title="New order"
        description="For orders taken by phone or WhatsApp. Prices come from the catalogue."
        back={
          <Link
            to="/orders"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm"
          >
            <ChevronLeft className="size-4" aria-hidden /> Orders
          </Link>
        }
      />
      <form
        className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <div className="grid gap-4">
          <Section title="Customer">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Mobile"
                htmlFor="f-phone"
                required
                error={fieldErr('customer.phone')}
                hint={
                  lookup.isFetching ? (
                    'Looking up…'
                  ) : known ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <UserCheck className="size-3.5" aria-hidden /> Returning customer · {known.orderCount}{' '}
                      order(s)
                      {known.creditAllowed ? ' · credit allowed' : ''}
                    </span>
                  ) : undefined
                }
              >
                <Input
                  id="f-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  autoFocus
                  value={f.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="98765 43210"
                  aria-invalid={!!fieldErr('customer.phone')}
                />
              </Field>
              {input('name', 'customer.name', 'Name', {}, true)}
              {input('altPhone', 'customer.altPhone', 'Alternate mobile', { type: 'tel', inputMode: 'tel' })}
              {input('email', 'customer.email', 'Email', { type: 'email' })}
              {input('gstin', 'customer.gstin', 'GSTIN (for business buyers)', { className: 'uppercase' })}
            </div>
            {known?.isBlocked ? (
              <p className="text-destructive mt-3 flex items-center gap-1.5 text-sm">
                <AlertTriangle className="size-4" aria-hidden /> This customer is blocked. The order will be
                refused.
              </p>
            ) : null}
          </Section>

          <Section
            title="Delivery address"
            description="The transport office nearest to the customer is usually enough."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {input('line1', 'address.line1', 'Address', { className: '' }, true)}
              {input('line2', 'address.line2', 'Address line 2')}
              {input('landmark', 'address.landmark', 'Landmark')}
              {input('city', 'address.city', 'City / town', {}, true)}
              <Field label="State" htmlFor="f-state" required error={fieldErr('address.stateCode')}>
                <Select value={f.stateCode} onValueChange={(v) => set('stateCode', v as IndianStateCode)}>
                  <SelectTrigger id="f-state" className="w-full">
                    <SelectValue placeholder="Choose" />
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
              {input(
                'pincode',
                'address.pincode',
                'PIN code',
                { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6 },
                true,
              )}
            </div>
          </Section>

          <Section title="Products">
            <LineEditor
              lines={lines}
              onChange={setLines}
              shortages={preview?.shortages}
              unavailable={preview?.unavailable}
            />
            {fieldErr('items') ? <p className="text-destructive mt-2 text-xs">{fieldErr('items')}</p> : null}
          </Section>

          <Section title="Notes">
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <Field label="Received via" htmlFor="f-source">
                <Select value={f.source} onValueChange={(v) => set('source', v as FormState['source'])}>
                  <SelectTrigger id="f-source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Phone call</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="admin">Walk-in / other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Customer instructions" htmlFor="f-notes" error={fieldErr('notes')}>
                <Textarea
                  id="f-notes"
                  rows={2}
                  value={f.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </Field>
            </div>
          </Section>
        </div>

        <div className="lg:sticky lg:top-20">
          <PreviewPanel
            stateCode={f.stateCode}
            city={f.city}
            lines={lines}
            onPreview={setPreview}
            footer={
              <Button
                type="submit"
                size="lg"
                className="mt-4 w-full"
                disabled={create.isPending || lines.length === 0}
              >
                {create.isPending ? <Spinner /> : null} Save as enquiry
              </Button>
            }
          />
        </div>
      </form>
    </>
  );
}
