import { Router, type RequestHandler } from 'express';
import { SETTINGS_ID, SettingsModel } from '../../../models/index.js';
import type { ApiDocs } from '../../../openapi/registry.js';
import { sendOk } from '../../../utils/http.js';

/**
 * Public API for the customer website (`sakthimaan-crackers` repo): no admin auth,
 * own CORS allowlist and rate limits (applied in app.ts). Write endpoints added in later
 * phases are mounted with `writeGuards` (strict per-IP limit + captcha).
 * Responses expose storefront-safe fields only.
 */
export function createPublicRouter(deps: {
  writeGuards: RequestHandler[];
  docs: ApiDocs;
  /** Feature modules add their public routes here (orders, …). */
  modules?: readonly ((r: Router, writeGuards: RequestHandler[], docs: ApiDocs) => void)[];
}): Router {
  const r = Router();
  for (const register of deps.modules ?? []) register(r, deps.writeGuards, deps.docs);

  r.get('/store', async (_req, res) => {
    const doc = await SettingsModel.findById(SETTINGS_ID).lean();
    // Unconfigured store: fall back to schema defaults.
    const s = doc ?? new SettingsModel({ company: { name: '' } }).toObject();
    const company = s.company;
    const storefront = s.storefront;
    const isOpen = storefront?.isOpen ?? true;
    const announcement = storefront?.announcement;
    sendOk(res, {
      configured: doc !== null,
      name: company?.name ?? '',
      phones: company?.phones ?? [],
      whatsappNumber: company?.whatsappNumber ?? null,
      email: company?.email ?? null,
      address: company?.address ?? null,
      gstin: company?.gstin ?? null,
      licenseNumber: company?.licenseNumber ?? null,
      isOpen,
      closedMessage: isOpen ? null : (storefront?.closedMessage ?? null),
      orderMode: storefront?.orderMode ?? 'enquiry',
      announcement: announcement?.isActive
        ? { text: announcement.text, linkUrl: announcement.linkUrl ?? null }
        : null,
      minOrderValue: s.order?.defaultMinOrderValue ?? null,
      safetyPageSlug: storefront?.safetyPageSlug ?? null,
      payment: s.payment?.showUpiQrOnStorefront
        ? {
            upiId: s.payment.upiId ?? null,
            upiPayeeName: s.payment.upiPayeeName ?? null,
            upiQrImageUrl: s.payment.upiQrImage?.url ?? null,
            bank: s.payment.bank ?? null,
            instructions: s.payment.instructions ?? null,
          }
        : null,
    });
  });

  deps.docs.register({
    method: 'get',
    path: '/api/v1/public/store',
    tag: 'Public (website)',
    auth: 'none',
    summary: 'Store details for the website: contact, licence, open/closed, order mode, UPI/bank details',
  });

  return r;
}
