import { useState } from 'react';
import { toast } from 'sonner';
import type { OrderDto } from '@sakthimaan/shared';
import { AddressFields, addressBody, addressDraft, type AddressDraft } from '@/components/address-fields';
import { Field, Spinner } from '@/components/common';
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
import { ApiError, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { PHONE_SHEET, cn } from '@/lib/utils';
import { useOrderMutations } from './api';

/**
 * Change the delivery address and contact while the order is still an enquiry (customers
 * often change these on the phone). The bill is recalculated: another state can change
 * GST (CGST+SGST vs IGST), the zone, minimum order and delivery terms.
 */
export function DeliveryDetailsDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const { update } = useOrderMutations(order.id);
  const [contact, setContact] = useState({
    name: order.customer.name,
    altPhone: order.customer.altPhone ?? '',
    email: order.customer.email ?? '',
    gstin: order.customer.gstin ?? '',
  });
  const [addr, setAddr] = useState<AddressDraft>(addressDraft(order.shippingAddress));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const stateChanged = addr.stateCode !== order.shippingAddress.stateCode;

  const save = async () => {
    setErrors({});
    if (!addr.stateCode) return setErrors({ 'address.stateCode': 'Choose a state' });
    try {
      const updated = await update.mutateAsync({
        version: order.version,
        address: addressBody(addr),
        customer: {
          name: contact.name.trim(),
          altPhone: contact.altPhone.trim() || undefined,
          email: contact.email.trim() || undefined,
          gstin: contact.gstin.trim() || undefined,
        },
      });
      toast.success(
        updated.pricing.grandTotal !== order.pricing.grandTotal
          ? `Saved. New total ${money(updated.pricing.grandTotal)}`
          : 'Delivery details saved',
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      toast.error(errorMessage(err));
    }
  };
  const addrErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith('address.'))
      .map(([k, v]) => [k.slice('address.'.length), v]),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('sm:max-w-lg', PHONE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Delivery details</DialogTitle>
          <DialogDescription>
            {order.orderNo} · the mobile number {order.customer.phone} stays (it identifies the customer).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="dd-name" error={errors['customer.name']} required>
              <Input
                id="dd-name"
                value={contact.name}
                onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
              />
            </Field>
            <Field label="Alternate mobile" htmlFor="dd-alt" error={errors['customer.altPhone']}>
              <Input
                id="dd-alt"
                type="tel"
                inputMode="tel"
                value={contact.altPhone}
                onChange={(e) => setContact((c) => ({ ...c, altPhone: e.target.value }))}
              />
            </Field>
            <Field label="Email" htmlFor="dd-email" error={errors['customer.email']}>
              <Input
                id="dd-email"
                type="email"
                value={contact.email}
                onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
              />
            </Field>
            <Field label="GSTIN" htmlFor="dd-gstin" error={errors['customer.gstin']}>
              <Input
                id="dd-gstin"
                className="uppercase"
                maxLength={15}
                value={contact.gstin}
                onChange={(e) => setContact((c) => ({ ...c, gstin: e.target.value.toUpperCase() }))}
              />
            </Field>
          </div>
          <AddressFields idPrefix="dd" value={addr} onChange={setAddr} errors={addrErrors} />
          {stateChanged ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              Different state: the bill is recalculated (GST type, zone, minimum order and delivery terms may
              change).
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={update.isPending}>
            {update.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
