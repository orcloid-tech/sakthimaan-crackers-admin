import { INDIAN_STATES, type AddressDto, type IndianStateCode } from '@sakthimaan/shared';
import { Field } from '@/components/common';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface AddressDraft {
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  district: string;
  stateCode: IndianStateCode | '';
  pincode: string;
}

export const addressDraft = (a?: AddressDto | null): AddressDraft => ({
  line1: a?.line1 ?? '',
  line2: a?.line2 ?? '',
  landmark: a?.landmark ?? '',
  city: a?.city ?? '',
  district: a?.district ?? '',
  stateCode: a?.stateCode ?? '',
  pincode: a?.pincode ?? '',
});

const opt = (v: string) => (v.trim() ? v.trim() : undefined);

/** Draft → API body (empty optional lines left out). Throws nothing: the API validates. */
export const addressBody = (a: AddressDraft) => ({
  line1: a.line1.trim(),
  line2: opt(a.line2),
  landmark: opt(a.landmark),
  city: a.city.trim(),
  district: opt(a.district),
  stateCode: a.stateCode as IndianStateCode,
  pincode: a.pincode.trim(),
});

/**
 * Delivery address inputs. `errors` uses the API's field paths relative to the address
 * ("line1", "pincode"); `idPrefix` keeps ids unique when two forms share a page.
 */
export function AddressFields({
  value,
  onChange,
  errors = {},
  idPrefix,
}: {
  value: AddressDraft;
  onChange: (a: AddressDraft) => void;
  errors?: Record<string, string | undefined>;
  idPrefix: string;
}) {
  const set = (k: keyof AddressDraft) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Address" htmlFor={id('line1')} error={errors.line1} required className="sm:col-span-2">
        <Input id={id('line1')} value={value.line1} onChange={set('line1')} aria-invalid={!!errors.line1} />
      </Field>
      <Field label="Address line 2" htmlFor={id('line2')} error={errors.line2}>
        <Input id={id('line2')} value={value.line2} onChange={set('line2')} />
      </Field>
      <Field label="Landmark" htmlFor={id('landmark')} error={errors.landmark}>
        <Input id={id('landmark')} value={value.landmark} onChange={set('landmark')} />
      </Field>
      <Field label="City / town" htmlFor={id('city')} error={errors.city} required>
        <Input id={id('city')} value={value.city} onChange={set('city')} aria-invalid={!!errors.city} />
      </Field>
      <Field label="District" htmlFor={id('district')} error={errors.district}>
        <Input id={id('district')} value={value.district} onChange={set('district')} />
      </Field>
      <Field label="State" htmlFor={id('state')} error={errors.stateCode} required>
        <Select
          value={value.stateCode}
          onValueChange={(v) => onChange({ ...value, stateCode: v as IndianStateCode })}
        >
          <SelectTrigger id={id('state')} className="w-full" aria-invalid={!!errors.stateCode}>
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
      <Field label="PIN code" htmlFor={id('pin')} error={errors.pincode} required>
        <Input
          id={id('pin')}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={value.pincode}
          onChange={set('pincode')}
          aria-invalid={!!errors.pincode}
        />
      </Field>
    </div>
  );
}
