import type { ClientSession } from 'mongoose';
import { DEFAULT_WHATSAPP_MESSAGES, INDIAN_STATES, STARTER_TEXTS, WHATSAPP_EVENTS } from '@sakthimaan/shared';
import type { Logger } from '../config/logger.js';
import { SETTINGS_ID, ServiceStateModel, SettingsModel, pricingContext } from '../models/index.js';

/**
 * Makes sure the settings document exists. A new store starts with no business details
 * (name, GSTIN, tax, prefixes stay empty until entered in Settings) and gets, once, the
 * starter texts for WhatsApp messages, website confirmations and document notes, so they
 * can be edited (or cleared) from the admin. After that the app reads only what is saved.
 */
export async function ensureSettings(session?: ClientSession): Promise<void> {
  const starter = {
    'storefront.messages.enquiryReceived': STARTER_TEXTS.enquiryReceived,
    'storefront.messages.checkoutConfirmed': STARTER_TEXTS.checkoutConfirmed,
    'documents.priceListNote': STARTER_TEXTS.priceListNote,
    'documents.priceListFooter': STARTER_TEXTS.priceListFooter,
    'documents.packingSlipNote': STARTER_TEXTS.packingSlipNote,
    'invoice.footerNote': STARTER_TEXTS.invoiceFooter,
  } as const;
  const existing = await SettingsModel.findById(SETTINGS_ID, {
    starterTextsAddedAt: 1,
    whatsappTemplates: 1,
    ...Object.fromEntries(Object.keys(starter).map((k) => [k, 1])),
  })
    .session(session ?? null)
    .lean();
  if (existing?.starterTextsAddedAt) return;

  // Only fill what is empty: a store set up before this existed keeps its own texts.
  const get = (path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
        existing,
      );
  const set: Record<string, unknown> = { starterTextsAddedAt: new Date() };
  for (const [path, text] of Object.entries(starter)) if (!get(path)) set[path] = text;
  const have = new Set((existing?.whatsappTemplates ?? []).map((t) => t.event));
  set.whatsappTemplates = [
    ...(existing?.whatsappTemplates ?? []),
    ...WHATSAPP_EVENTS.filter((e) => !have.has(e)).map((event) => ({
      event,
      message: DEFAULT_WHATSAPP_MESSAGES[event],
    })),
  ];
  await SettingsModel.updateOne({ _id: SETTINGS_ID }, { $set: set }, { upsert: true, session });
}

/**
 * Every state/UT has a delivery row (the legal list with GST codes), switched off until
 * the store turns it on in Delivery & zones: where you deliver is never assumed.
 */
export async function ensureStates(): Promise<void> {
  const count = await ServiceStateModel.estimatedDocumentCount();
  if (count >= INDIAN_STATES.length) return;
  await ServiceStateModel.bulkWrite(
    INDIAN_STATES.map((s) => ({
      updateOne: {
        filter: { code: s.code },
        update: { $setOnInsert: { code: s.code, name: s.name, gstCode: s.gstCode, isServiceable: false } },
        upsert: true,
      },
    })),
  );
}

/**
 * Loads settings that model hooks need synchronously (net-price rounding mode).
 * Called at startup; the settings service updates it after changes.
 */
export async function loadRuntimeSettings(logger: Logger): Promise<void> {
  await ensureSettings();
  await ensureStates();
  const settings = await SettingsModel.findById(SETTINGS_ID).select('pricing company.name').lean();
  const mode = settings?.pricing?.netPriceRounding;
  if (mode) pricingContext.setRoundingMode(mode);
  logger.info(
    { netPriceRounding: pricingContext.roundingMode, storeNameSet: !!settings?.company?.name },
    'Runtime settings loaded',
  );
}
