import { useRef, useState, type ReactNode } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  INDIAN_STATES,
  NET_PRICE_ROUNDING_MODES,
  PAYMENT_METHODS,
  STARTER_TEXTS,
  computeNetPrice,
  financialYearOf,
  formatDocumentNumber,
  type IndianStateCode,
  type NetPriceRounding,
  type OrderMode,
  type PaymentMethod,
  type SettingsDto,
} from '@sakthimaan/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, Section, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { money, parseRupees, rupeesText } from '@/lib/format';
import { METHOD_LABEL } from '../orders/order-bits';
import { useSettingsMutations } from './api';
import { SaveBar, opt, useSaveSection } from './form-bits';

type Props = { s: SettingsDto; canEdit: boolean };

/** Empty state choice (typed, so form state accepts a state code later). */
const NO_STATE: IndianStateCode | '' = '';

function Form({
  onSubmit,
  canEdit,
  children,
}: {
  onSubmit: () => void;
  canEdit: boolean;
  children: ReactNode;
}) {
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={!canEdit} className="grid min-w-0 gap-4">
        {children}
      </fieldset>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  className,
  fieldClassName,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  fieldClassName?: string;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'id'>) {
  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      hint={hint}
      required={required}
      className={fieldClassName}
    >
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        className={className}
        {...props}
      />
    </Field>
  );
}

/** A longer text with an optional "use starter text" button (starter texts are suggestions only). */
function NoteField({
  id,
  label,
  value,
  onChange,
  starter,
  hint,
  rows = 2,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  starter?: string;
  hint?: ReactNode;
  rows?: number;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <Textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {starter && !value.trim() ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto justify-self-start p-0"
          onClick={() => onChange(starter)}
        >
          Use starter text
        </Button>
      ) : null}
    </Field>
  );
}

function StateSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: IndianStateCode) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as IndianStateCode)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {INDIAN_STATES.map((st) => (
          <SelectItem key={st.code} value={st.code}>
            {st.name} ({st.gstCode})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Image upload tile used for the logo and the UPI QR. */
function ImageTile({
  label,
  url,
  kind,
  canEdit,
  hint,
}: {
  label: string;
  url: string | null;
  kind: 'logo' | 'upi-qr';
  canEdit: boolean;
  hint: string;
}) {
  const { setImage, removeImage } = useSettingsMutations();
  const input = useRef<HTMLInputElement>(null);
  const busy = setImage.isPending || removeImage.isPending;
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <div className="bg-muted grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border">
          {url ? (
            <img src={url} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImagePlus className="text-muted-foreground size-6" aria-hidden />
          )}
        </div>
        {canEdit ? (
          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {setImage.isPending ? <Spinner /> : <ImagePlus />} {url ? 'Replace' : 'Upload'}
            </Button>
            {url ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={busy}
                onClick={() =>
                  void removeImage
                    .mutateAsync(kind)
                    .then(() => toast.success('Removed'))
                    .catch((err: unknown) => toast.error(errorMessage(err)))
                }
              >
                <Trash2 /> Remove
              </Button>
            ) : null}
          </div>
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label={`Upload ${label}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setImage
              .mutateAsync({ kind, file })
              .then(() => toast.success(`${label} updated`))
              .catch((err: unknown) => toast.error(errorMessage(err)));
          }}
        />
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

// ------------------------------------------------------------------ company

export function CompanySection({ s, canEdit }: Props) {
  const c = s.company;
  const a = c.address;
  const [f, setF] = useState({
    name: c.name ?? '',
    legalName: c.legalName ?? '',
    phones: c.phones.join(', '),
    whatsappNumber: c.whatsappNumber ?? '',
    email: c.email ?? '',
    gstin: c.gstin ?? '',
    licenseNumber: c.licenseNumber ?? '',
    licenseValidTill: c.licenseValidTill?.slice(0, 10) ?? '',
    line1: a?.line1 ?? '',
    line2: a?.line2 ?? '',
    city: a?.city ?? '',
    district: a?.district ?? '',
    stateCode: a?.stateCode ?? s.tax.sellerStateCode ?? NO_STATE,
    pincode: a?.pincode ?? '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { save, errors, setErrors, saving } = useSaveSection('company');
  const gstinState =
    f.gstin.length >= 2 ? INDIAN_STATES.find((st) => st.gstCode === f.gstin.slice(0, 2)) : undefined;

  return (
    <Form
      canEdit={canEdit}
      onSubmit={() => {
        if (f.line1.trim() && !f.stateCode) return setErrors({ 'address.stateCode': 'Choose the state' });
        void save(s.version, {
          name: f.name,
          legalName: opt(f.legalName),
          phones: f.phones
            .split(/[,/]/)
            .map((p) => p.trim())
            .filter(Boolean),
          whatsappNumber: opt(f.whatsappNumber),
          email: opt(f.email),
          gstin: opt(f.gstin),
          licenseNumber: opt(f.licenseNumber),
          licenseValidTill: opt(f.licenseValidTill),
          address:
            f.line1.trim() && f.stateCode
              ? {
                  line1: f.line1,
                  line2: opt(f.line2),
                  city: f.city,
                  district: opt(f.district),
                  stateCode: f.stateCode,
                  pincode: f.pincode,
                }
              : undefined,
        });
      }}
    >
      <Section
        title="Business"
        description="Printed on invoices, packing slips, credit notes and the price list."
      >
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <ImageTile
            label="Logo"
            url={c.logoUrl}
            kind="logo"
            canEdit={canEdit}
            hint="PNG with a transparent background looks best."
          />
          <div className="grid content-start gap-3 sm:grid-cols-2">
            <TextField
              id="c-name"
              label="Store name"
              required
              value={f.name}
              onChange={set('name')}
              error={errors.name}
            />
            <TextField
              id="c-legal"
              label="Legal name (as on GST registration)"
              value={f.legalName}
              onChange={set('legalName')}
              error={errors.legalName}
            />
            <TextField
              id="c-gstin"
              label="GSTIN"
              className="uppercase"
              value={f.gstin}
              onChange={(v) => set('gstin')(v.toUpperCase())}
              error={errors.gstin}
              hint={gstinState ? `Registered in ${gstinState.name}` : '15 characters, needed for invoices'}
              maxLength={15}
            />
            <TextField
              id="c-licence"
              label="Explosives licence number"
              value={f.licenseNumber}
              onChange={set('licenseNumber')}
              error={errors.licenseNumber}
            />
            <TextField
              id="c-licence-till"
              label="Licence valid till"
              type="date"
              value={f.licenseValidTill}
              onChange={set('licenseValidTill')}
              error={errors.licenseValidTill}
            />
          </div>
        </div>
      </Section>
      <Section title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="c-phones"
            label="Phone numbers"
            inputMode="tel"
            value={f.phones}
            onChange={set('phones')}
            error={Object.entries(errors).find(([k]) => k.startsWith('phones'))?.[1]}
            hint="Separate with commas (up to 5)"
          />
          <TextField
            id="c-wa"
            label="WhatsApp number"
            type="tel"
            inputMode="tel"
            value={f.whatsappNumber}
            onChange={set('whatsappNumber')}
            error={errors.whatsappNumber}
          />
          <TextField
            id="c-email"
            label="Email"
            type="email"
            value={f.email}
            onChange={set('email')}
            error={errors.email}
          />
        </div>
      </Section>
      <Section title="Address" description="Printed on invoices. Needed before the first invoice.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="c-line1"
            label="Address"
            value={f.line1}
            onChange={set('line1')}
            error={errors['address.line1']}
          />
          <TextField
            id="c-line2"
            label="Address line 2"
            value={f.line2}
            onChange={set('line2')}
            error={errors['address.line2']}
          />
          <TextField
            id="c-city"
            label="City / town"
            value={f.city}
            onChange={set('city')}
            error={errors['address.city']}
          />
          <TextField
            id="c-district"
            label="District"
            value={f.district}
            onChange={set('district')}
            error={errors['address.district']}
          />
          <Field label="State" htmlFor="c-state" error={errors['address.stateCode']}>
            <StateSelect
              id="c-state"
              value={f.stateCode}
              onChange={(v) => setF((x) => ({ ...x, stateCode: v }))}
            />
          </Field>
          <TextField
            id="c-pin"
            label="PIN code"
            inputMode="numeric"
            maxLength={6}
            value={f.pincode}
            onChange={set('pincode')}
            error={errors['address.pincode']}
          />
        </div>
      </Section>
      {canEdit ? (
        <SaveBar saving={saving} note="Issued invoices keep the details they were issued with." />
      ) : null}
    </Form>
  );
}

// ------------------------------------------------------------------ storefront

export function StoreSection({ s, canEdit }: Props) {
  const st = s.storefront;
  const [f, setF] = useState({
    isOpen: st.isOpen,
    closedMessage: st.closedMessage ?? '',
    orderMode: st.orderMode,
    text: st.announcement.text ?? '',
    linkUrl: st.announcement.linkUrl ?? '',
    isActive: st.announcement.isActive,
    enquiryReceived: st.messages.enquiryReceived ?? '',
    checkoutConfirmed: st.messages.checkoutConfirmed ?? '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { save, errors, saving } = useSaveSection('storefront');
  return (
    <Form
      canEdit={canEdit}
      onSubmit={() =>
        void save(
          s.version,
          {
            isOpen: f.isOpen,
            closedMessage: opt(f.closedMessage),
            orderMode: f.orderMode,
            announcement: {
              text: opt(f.text),
              linkUrl: opt(f.linkUrl),
              isActive: f.isActive && !!f.text.trim(),
            },
            messages: {
              enquiryReceived: opt(f.enquiryReceived),
              checkoutConfirmed: opt(f.checkoutConfirmed),
            },
          },
          f.isOpen ? 'Saved. The store is open.' : 'Saved. The store is closed to new orders.',
        )
      }
    >
      <Section title="Taking orders">
        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <span>
            <span className="block font-medium">Store is open</span>
            <span className="text-muted-foreground text-sm">
              When closed, the website shows your message and refuses new enquiries. Staff can still take
              orders.
            </span>
          </span>
          <Switch
            checked={f.isOpen}
            onCheckedChange={(v) => setF((x) => ({ ...x, isOpen: v }))}
            aria-label="Store is open"
          />
        </label>
        {!f.isOpen ? (
          <Field
            label="Message shown while closed"
            htmlFor="st-closed"
            error={errors.closedMessage}
            className="mt-3"
          >
            <Textarea
              id="st-closed"
              rows={2}
              value={f.closedMessage}
              onChange={(e) => set('closedMessage')(e.target.value)}
            />
          </Field>
        ) : null}
        <div className="mt-4 grid gap-2">
          <span className="text-sm font-medium">How website orders work</span>
          <RadioGroup
            value={f.orderMode}
            onValueChange={(v) => setF((x) => ({ ...x, orderMode: v as OrderMode }))}
            className="grid gap-2 sm:grid-cols-2"
          >
            {(
              [
                [
                  'enquiry',
                  'Enquiry (recommended)',
                  'Customers send a list; staff call, confirm and share the total. Stock is held only when staff confirm.',
                ],
                [
                  'checkout',
                  'Checkout',
                  'Orders are confirmed immediately and stock is reserved; the customer is shown UPI payment details.',
                ],
              ] as const
            ).map(([value, title, text]) => (
              <label
                key={value}
                className="has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex cursor-pointer gap-3 rounded-lg border p-3"
              >
                <RadioGroupItem value={value} className="mt-0.5" />
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-muted-foreground text-sm">{text}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
      </Section>
      <Section
        title="Messages after ordering"
        description="Shown on the website once a customer submits. Leave empty to show nothing extra."
      >
        <div className="grid gap-3">
          <NoteField
            id="st-msg-enq"
            label="After an enquiry"
            value={f.enquiryReceived}
            onChange={set('enquiryReceived')}
            starter={STARTER_TEXTS.enquiryReceived}
            error={errors['messages.enquiryReceived']}
          />
          <NoteField
            id="st-msg-co"
            label="After a checkout order"
            value={f.checkoutConfirmed}
            onChange={set('checkoutConfirmed')}
            starter={STARTER_TEXTS.checkoutConfirmed}
            error={errors['messages.checkoutConfirmed']}
          />
        </div>
      </Section>
      <Section title="Announcement bar" description="A short line at the top of the website.">
        <div className="grid gap-3">
          <Field label="Text" htmlFor="st-ann" error={errors['announcement.text']}>
            <Input id="st-ann" value={f.text} maxLength={300} onChange={(e) => set('text')(e.target.value)} />
          </Field>
          <TextField
            id="st-link"
            label="Link (optional)"
            type="url"
            value={f.linkUrl}
            onChange={set('linkUrl')}
            error={errors['announcement.linkUrl']}
          />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.isActive} onCheckedChange={(v) => setF((x) => ({ ...x, isActive: v }))} /> Show
            on the website
          </label>
        </div>
      </Section>
      {canEdit ? <SaveBar saving={saving} /> : null}
    </Form>
  );
}

// ------------------------------------------------------------------ tax, rounding, invoice numbers, document notes

const seqDigits = (format: string) => Number(/\{SEQ:(\d)\}/.exec(format)?.[1] ?? 5);
const ROUNDING_TEXT: Record<NetPriceRounding, string> = {
  nearest_rupee: 'Nearest rupee (₹199)',
  nearest_paisa: 'Exact to the paisa (₹198.98)',
};

export function BillingSection({ s, canEdit }: Props) {
  const [tax, setTax] = useState({
    sellerStateCode: s.tax.sellerStateCode ?? NO_STATE,
    defaultHsn: s.tax.defaultHsn ?? '',
    defaultTaxRate: s.tax.defaultTaxRate === null ? '' : String(s.tax.defaultTaxRate),
    netPriceRounding: s.tax.netPriceRounding,
    b2cl: s.tax.b2clThreshold === null ? '' : rupeesText(s.tax.b2clThreshold),
  });
  const [inv, setInv] = useState({
    prefix: s.invoice.prefix ?? '',
    creditNotePrefix: s.invoice.creditNotePrefix,
    digits: String(seqDigits(s.invoice.format)),
    terms: s.invoice.terms ?? '',
    footerNote: s.invoice.footerNote ?? '',
    showUpiQr: s.invoice.showUpiQr,
  });
  const [docs, setDocs] = useState({
    priceListNote: s.documents.priceListNote ?? '',
    priceListFooter: s.documents.priceListFooter ?? '',
    packingSlipNote: s.documents.packingSlipNote ?? '',
  });
  const taxSave = useSaveSection('tax');
  const invSave = useSaveSection('invoice');
  const docSave = useSaveSection('documents');
  const [confirmRounding, setConfirmRounding] = useState(false);
  const roundingChanged = tax.netPriceRounding !== s.tax.netPriceRounding;
  const format = `{PREFIX}/{FY}/{SEQ:${inv.digits}}`;
  const fy = financialYearOf(new Date());
  const sample = (prefix: string) => {
    if (!prefix) return 'Enter a prefix';
    try {
      return formatDocumentNumber(format, { prefix: prefix.toUpperCase(), fy, seq: 42 });
    } catch (err) {
      return err instanceof Error ? err.message : 'Too long';
    }
  };
  const prefixChanged =
    !!s.invoice.prefix &&
    (inv.prefix !== s.invoice.prefix || inv.creditNotePrefix !== s.invoice.creditNotePrefix);

  const saveTax = () =>
    taxSave.save(
      s.version,
      {
        sellerStateCode: tax.sellerStateCode || undefined,
        defaultHsn: opt(tax.defaultHsn),
        defaultTaxRate: tax.defaultTaxRate.trim() === '' ? undefined : Number(tax.defaultTaxRate),
        netPriceRounding: tax.netPriceRounding,
        b2clThreshold: tax.b2cl.trim() ? (parseRupees(tax.b2cl) ?? undefined) : undefined,
      },
      roundingChanged ? 'Saved. All net prices were recalculated.' : 'Saved',
    );

  return (
    <div className="grid gap-4">
      <Form canEdit={canEdit} onSubmit={() => (roundingChanged ? setConfirmRounding(true) : void saveTax())}>
        <Section
          title="GST"
          description="Prices are GST-inclusive. The default rate and HSN apply when a product and its category don't set their own."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Business state (place of supply)"
              htmlFor="t-state"
              error={taxSave.errors.sellerStateCode}
              hint="Decides CGST + SGST or IGST. Needed for any order."
            >
              <StateSelect
                id="t-state"
                value={tax.sellerStateCode}
                onChange={(v) => setTax((x) => ({ ...x, sellerStateCode: v }))}
              />
            </Field>
            <TextField
              id="t-hsn"
              label="Default HSN"
              inputMode="numeric"
              value={tax.defaultHsn}
              onChange={(v) => setTax((x) => ({ ...x, defaultHsn: v }))}
              error={taxSave.errors.defaultHsn}
              hint="4, 6 or 8 digits"
            />
            <TextField
              id="t-rate"
              label="Default GST %"
              inputMode="decimal"
              value={tax.defaultTaxRate}
              onChange={(v) => setTax((x) => ({ ...x, defaultTaxRate: v }))}
              error={taxSave.errors.defaultTaxRate}
            />
            <TextField
              id="t-b2cl"
              label="B2C large invoice limit (₹)"
              inputMode="decimal"
              fieldClassName="sm:col-span-3 sm:max-w-sm"
              value={tax.b2cl}
              onChange={(v) => setTax((x) => ({ ...x, b2cl: v }))}
              error={taxSave.errors.b2clThreshold}
              hint="GSTR-1: inter-state invoices to unregistered buyers above this are listed one by one (b2cl). Confirm the current limit with your accountant."
            />
          </div>
          <div className="mt-4 grid gap-2">
            <span className="text-sm font-medium">Net price rounding</span>
            <RadioGroup
              value={tax.netPriceRounding}
              onValueChange={(v) => setTax((x) => ({ ...x, netPriceRounding: v as NetPriceRounding }))}
              className="grid gap-2 sm:grid-cols-2"
            >
              {NET_PRICE_ROUNDING_MODES.map((m) => (
                <label
                  key={m}
                  className="has-data-[state=checked]:border-primary flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
                >
                  <RadioGroupItem value={m} /> {ROUNDING_TEXT[m]}
                </label>
              ))}
            </RadioGroup>
            <p className="text-muted-foreground text-xs">
              Example: MRP ₹1,137 at 82.5% off → {money(computeNetPrice(113_700, 82.5, tax.netPriceRounding))}
              .{roundingChanged ? ' Saving re-prices every product.' : ''}
            </p>
          </div>
        </Section>
        {canEdit ? <SaveBar saving={taxSave.saving} /> : null}
      </Form>
      <ConfirmDialog
        open={confirmRounding}
        onOpenChange={setConfirmRounding}
        title="Change rounding for all products?"
        description="Every product's net price is recalculated now and the website shows the new prices. Orders already placed keep their prices."
        confirmLabel="Change and re-price"
        onConfirm={async () => {
          if (!(await saveTax())) throw new Error('not saved');
        }}
      />

      <Form
        canEdit={canEdit}
        onSubmit={() =>
          void invSave.save(s.version, {
            prefix: opt(inv.prefix),
            creditNotePrefix: inv.creditNotePrefix,
            format,
            creditNoteFormat: format,
            terms: opt(inv.terms),
            footerNote: opt(inv.footerNote),
            showUpiQr: inv.showUpiQr,
          })
        }
      >
        <Section
          title="Invoice & credit note numbers"
          description="Numbers restart every financial year (April). GST allows 16 characters."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              id="i-prefix"
              label="Invoice prefix"
              className="uppercase"
              value={inv.prefix}
              maxLength={10}
              placeholder="ABC"
              onChange={(v) => setInv((x) => ({ ...x, prefix: v.toUpperCase() }))}
              error={invSave.errors.prefix ?? invSave.errors.format}
              hint={<span className="font-mono">{sample(inv.prefix)}</span>}
            />
            <TextField
              id="i-cn-prefix"
              label="Credit note prefix"
              className="uppercase"
              value={inv.creditNotePrefix}
              maxLength={10}
              onChange={(v) => setInv((x) => ({ ...x, creditNotePrefix: v.toUpperCase() }))}
              error={invSave.errors.creditNotePrefix ?? invSave.errors.creditNoteFormat}
              hint={<span className="font-mono">{sample(inv.creditNotePrefix)}</span>}
            />
            <Field label="Number digits" htmlFor="i-digits">
              <Select value={inv.digits} onValueChange={(v) => setInv((x) => ({ ...x, digits: v }))}>
                <SelectTrigger id="i-digits" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['4', '5', '6'].map((d) => (
                    <SelectItem key={d} value={d}>
                      {d} digits
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {s.invoice.sampleInvoiceNo ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Next invoice: <span className="font-mono">{s.invoice.sampleInvoiceNo}</span> · next credit note:{' '}
              <span className="font-mono">{s.invoice.sampleCreditNoteNo}</span>
            </p>
          ) : (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Set an invoice prefix before issuing the first invoice.
            </p>
          )}
          {prefixChanged ? (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              Changing the prefix during a financial year is allowed, but keep one series per year if your
              accountant prefers. Issued invoices keep their numbers.
            </p>
          ) : null}
        </Section>
        <Section title="Printed on invoices">
          <div className="grid gap-3">
            <NoteField
              id="i-terms"
              label="Terms"
              rows={3}
              value={inv.terms}
              onChange={(v) => setInv((x) => ({ ...x, terms: v }))}
              error={invSave.errors.terms}
            />
            <NoteField
              id="i-footer"
              label="Footer note"
              value={inv.footerNote}
              onChange={(v) => setInv((x) => ({ ...x, footerNote: v }))}
              starter={STARTER_TEXTS.invoiceFooter}
              error={invSave.errors.footerNote}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={inv.showUpiQr}
                onCheckedChange={(v) => setInv((x) => ({ ...x, showUpiQr: v }))}
              />{' '}
              Print a UPI QR code for the amount due
            </label>
          </div>
        </Section>
        {canEdit ? <SaveBar saving={invSave.saving} /> : null}
      </Form>

      <Form
        canEdit={canEdit}
        onSubmit={() =>
          void docSave.save(s.version, {
            priceListNote: opt(docs.priceListNote),
            priceListFooter: opt(docs.priceListFooter),
            packingSlipNote: opt(docs.packingSlipNote),
          })
        }
      >
        <Section
          title="Price list & packing slip"
          description="Printed on these documents. Leave empty to print nothing."
        >
          <div className="grid gap-3">
            <NoteField
              id="d-pl-note"
              label="Price list: note under the title"
              value={docs.priceListNote}
              onChange={(v) => setDocs((x) => ({ ...x, priceListNote: v }))}
              starter={STARTER_TEXTS.priceListNote}
              error={docSave.errors.priceListNote}
            />
            <NoteField
              id="d-pl-footer"
              label="Price list: footer"
              value={docs.priceListFooter}
              onChange={(v) => setDocs((x) => ({ ...x, priceListFooter: v }))}
              starter={STARTER_TEXTS.priceListFooter}
              error={docSave.errors.priceListFooter}
            />
            <NoteField
              id="d-ps-note"
              label="Packing slip: handling note"
              value={docs.packingSlipNote}
              onChange={(v) => setDocs((x) => ({ ...x, packingSlipNote: v }))}
              starter={STARTER_TEXTS.packingSlipNote}
              error={docSave.errors.packingSlipNote}
            />
          </div>
        </Section>
        {canEdit ? <SaveBar saving={docSave.saving} /> : null}
      </Form>
    </div>
  );
}

// ------------------------------------------------------------------ payments

export function PaymentsSection({ s, canEdit }: Props) {
  const p = s.payment;
  const [f, setF] = useState({
    upiId: p.upiId ?? '',
    upiPayeeName: p.upiPayeeName ?? '',
    showUpiQrOnStorefront: p.showUpiQrOnStorefront,
    accountName: p.bank?.accountName ?? '',
    accountNumber: p.bank?.accountNumber ?? '',
    ifsc: p.bank?.ifsc ?? '',
    bankName: p.bank?.bankName ?? '',
    branch: p.bank?.branch ?? '',
    instructions: p.instructions ?? '',
  });
  const [methods, setMethods] = useState<Set<PaymentMethod>>(new Set(p.acceptedMethods));
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { save, errors, saving } = useSaveSection('payment');
  const anyBank = [f.accountName, f.accountNumber, f.ifsc, f.bankName].some((v) => v.trim());
  return (
    <Form
      canEdit={canEdit}
      onSubmit={() =>
        void save(s.version, {
          upiId: opt(f.upiId),
          upiPayeeName: opt(f.upiPayeeName),
          showUpiQrOnStorefront: f.showUpiQrOnStorefront,
          acceptedMethods: PAYMENT_METHODS.filter((m) => methods.has(m)),
          bank: anyBank
            ? {
                accountName: f.accountName,
                accountNumber: f.accountNumber.replace(/\s/g, ''),
                ifsc: f.ifsc,
                bankName: f.bankName,
                branch: opt(f.branch),
              }
            : undefined,
          instructions: opt(f.instructions),
        })
      }
    >
      <Section
        title="Payment methods you accept"
        description="Staff can record only these; the website shows them to customers."
      >
        <div className="flex flex-wrap gap-4">
          {PAYMENT_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={methods.has(m)}
                onCheckedChange={(v) =>
                  setMethods((cur) => {
                    const n = new Set(cur);
                    if (v === true) n.add(m);
                    else n.delete(m);
                    return n;
                  })
                }
              />
              {METHOD_LABEL[m]}
            </label>
          ))}
        </div>
        {errors.acceptedMethods ? (
          <p className="text-destructive mt-2 text-xs">{errors.acceptedMethods}</p>
        ) : null}
      </Section>
      <Section
        title="UPI"
        description="Shown in WhatsApp messages, on invoices (as a QR for the amount due) and on the website."
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="grid content-start gap-3">
            <TextField
              id="p-upi"
              label="UPI ID"
              value={f.upiId}
              onChange={set('upiId')}
              error={errors.upiId}
              placeholder="name@bank"
            />
            <TextField
              id="p-payee"
              label="Payee name"
              value={f.upiPayeeName}
              onChange={set('upiPayeeName')}
              error={errors.upiPayeeName}
              hint="The name customers see in their UPI app"
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={f.showUpiQrOnStorefront}
                onCheckedChange={(v) => setF((x) => ({ ...x, showUpiQrOnStorefront: v }))}
              />{' '}
              Show UPI and bank details on the website
            </label>
          </div>
          <ImageTile
            label="UPI QR image"
            url={p.upiQrUrl}
            kind="upi-qr"
            canEdit={canEdit}
            hint="Optional: your bank's printed QR. Invoices generate their own."
          />
        </div>
      </Section>
      <Section title="Bank account" description="For NEFT / IMPS payments. Leave all blank to hide.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="p-acname"
            label="Account name"
            value={f.accountName}
            onChange={set('accountName')}
            error={errors['bank.accountName']}
          />
          <TextField
            id="p-acno"
            label="Account number"
            inputMode="numeric"
            value={f.accountNumber}
            onChange={set('accountNumber')}
            error={errors['bank.accountNumber']}
          />
          <TextField
            id="p-ifsc"
            label="IFSC"
            className="uppercase"
            maxLength={11}
            value={f.ifsc}
            onChange={(v) => set('ifsc')(v.toUpperCase())}
            error={errors['bank.ifsc']}
          />
          <TextField
            id="p-bank"
            label="Bank"
            value={f.bankName}
            onChange={set('bankName')}
            error={errors['bank.bankName']}
          />
          <TextField
            id="p-branch"
            label="Branch"
            value={f.branch}
            onChange={set('branch')}
            error={errors['bank.branch']}
          />
        </div>
      </Section>
      <Section title="Payment instructions" description="Shown on the website with the payment details.">
        <Textarea
          aria-label="Payment instructions"
          rows={3}
          value={f.instructions}
          onChange={(e) => set('instructions')(e.target.value)}
        />
      </Section>
      {canEdit ? <SaveBar saving={saving} /> : null}
    </Form>
  );
}

// ------------------------------------------------------------------ orders & stock defaults

export function OrdersSection({ s, canEdit }: Props) {
  const o = s.order;
  const [f, setF] = useState({
    numberPrefix: o.numberPrefix,
    minOrder: rupeesText(o.defaultMinOrderValue),
    packingChargePct: String(o.packingChargePct),
    autoCancel: String(o.autoCancelUnpaidCheckoutHours),
    lowStock: String(o.defaultLowStockThreshold),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { save, errors, setErrors, saving } = useSaveSection('order');
  return (
    <Form
      canEdit={canEdit}
      onSubmit={() => {
        const min = f.minOrder.trim() ? parseRupees(f.minOrder) : 0;
        if (min === null) return setErrors({ defaultMinOrderValue: 'Enter an amount' });
        void save(s.version, {
          numberPrefix: f.numberPrefix,
          defaultMinOrderValue: min,
          packingChargePct: Number(f.packingChargePct || 0),
          autoCancelUnpaidCheckoutHours: Number(f.autoCancel),
          defaultLowStockThreshold: Number(f.lowStock || 0),
        });
      }}
    >
      <Section title="Orders">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="o-prefix"
            label="Order number prefix"
            className="uppercase"
            maxLength={6}
            value={f.numberPrefix}
            onChange={(v) => set('numberPrefix')(v.toUpperCase())}
            error={errors.numberPrefix}
            hint={
              <span className="font-mono">{`${f.numberPrefix || 'ORD'}/${financialYearOf(new Date()).short}/000123`}</span>
            }
          />
          <TextField
            id="o-min"
            label="Default minimum order (₹)"
            inputMode="decimal"
            value={f.minOrder}
            onChange={set('minOrder')}
            error={errors.defaultMinOrderValue}
            hint="0 or empty = no minimum. Zones, states and cities can set their own."
          />
          <TextField
            id="o-packing"
            label="Packing charge (% of subtotal)"
            inputMode="decimal"
            value={f.packingChargePct}
            onChange={set('packingChargePct')}
            error={errors.packingChargePct}
            hint="0 for none"
          />
          <TextField
            id="o-cancel"
            label="Checkout mode: cancel unpaid after (hours)"
            inputMode="numeric"
            value={f.autoCancel}
            onChange={set('autoCancel')}
            error={errors.autoCancelUnpaidCheckoutHours}
            hint="Not automatic yet; listed in the hardening backlog"
          />
        </div>
      </Section>
      <Section title="Stock">
        <TextField
          id="o-low"
          label="Default low-stock alert level"
          inputMode="numeric"
          fieldClassName="sm:max-w-xs"
          value={f.lowStock}
          onChange={set('lowStock')}
          error={errors.defaultLowStockThreshold}
          hint="Given to new products that don't set their own. 0 = no alert."
        />
      </Section>
      {canEdit ? <SaveBar saving={saving} /> : null}
    </Form>
  );
}
