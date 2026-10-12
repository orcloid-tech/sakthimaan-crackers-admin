import type { ClientSession, HydratedDocument } from 'mongoose';
import {
  DEFAULT_CREDIT_NOTE_FORMAT,
  DEFAULT_HSN,
  DEFAULT_INVOICE_FORMAT,
  DEFAULT_INVOICE_PREFIX,
  DEFAULT_NET_PRICE_ROUNDING,
  DEFAULT_SELLER_STATE_CODE,
  DEFAULT_TAX_RATE,
  DEFAULT_WHATSAPP_MESSAGES,
  WHATSAPP_EVENTS,
  computeNetPrice,
  counterKey,
  financialYearOf,
  formatDocumentNumber,
  type NetPriceRounding,
  type Permission,
  type RuntimeSettingsDto,
  type SeasonDto,
  type SeasonInput,
  type SettingsDto,
  type SettingsSection,
  type SettingsUpdateInput,
  type WhatsAppEvent,
} from '@sakthimaan/shared';
import type { RequestMeta } from '../middlewares/request-context.js';
import {
  CounterModel,
  ProductModel,
  SETTINGS_ID,
  SeasonModel,
  SettingsModel,
  pricingContext,
  type Settings,
} from '../models/index.js';
import { processImage, type StorageProvider } from '../providers/storage/index.js';
import { conflict, forbidden, notFound } from '../utils/app-error.js';
import { withTransaction } from '../utils/transaction.js';
import { diffFields, type AuditActor, type AuditService } from './audit.service.js';
import type { SettingsCache } from './settings-cache.js';

type SettingsDoc = HydratedDocument<Settings>;

export interface SettingsActor extends AuditActor {
  permissions: ReadonlySet<Permission>;
}

/** Sections storefront managers (cms:manage) may change without full settings access. */
const STOREFRONT_ONLY: readonly SettingsSection[] = ['storefront'];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** Leaf paths of an object, in dot notation (arrays are compared whole). */
function leafPaths(obj: unknown, prefix: string): string[] {
  if (!isPlainObject(obj)) return [prefix];
  const keys = Object.keys(obj);
  if (keys.length === 0) return [prefix];
  return keys.flatMap((k) => leafPaths(obj[k], `${prefix}.${k}`));
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Store settings: one document, edited a section at a time with a version check, every
 * change audited with a field-level diff. Effects outside the document:
 * - the settings cache is cleared, so orders and PDFs use the new values at once;
 * - a new rounding mode re-prices every product in the same transaction (the mode is
 *   also what the product form previews with);
 * - invoices and credit notes already issued keep the seller details they were issued
 *   with (GST documents must not change after issue); new ones use the new details.
 */
export class SettingsService {
  constructor(
    private readonly deps: { audit: AuditService; cache: SettingsCache; storage: StorageProvider },
  ) {}

  async get(): Promise<SettingsDto> {
    return this.toDto(await this.load());
  }

  async runtime(): Promise<RuntimeSettingsDto> {
    const s = await this.deps.cache.get();
    return {
      companyName: s?.company?.name ?? 'Sakthimaan Crackers',
      netPriceRounding: s?.pricing?.netPriceRounding ?? DEFAULT_NET_PRICE_ROUNDING,
      defaultHsn: s?.tax?.defaultHsn ?? DEFAULT_HSN,
      defaultTaxRate: s?.tax?.defaultTaxRate ?? DEFAULT_TAX_RATE,
      sellerStateCode: s?.tax?.sellerStateCode ?? DEFAULT_SELLER_STATE_CODE,
      defaultLowStockThreshold: s?.inventory?.defaultLowStockThreshold ?? 10,
      isOpen: s?.storefront?.isOpen ?? true,
      orderMode: s?.storefront?.orderMode ?? 'enquiry',
    };
  }

  async update(input: SettingsUpdateInput, actor: SettingsActor, meta: RequestMeta): Promise<SettingsDto> {
    const { version, ...sections } = input;
    const names = Object.keys(sections) as SettingsSection[];
    const full = actor.permissions.has('settings:update');
    const blocked = names.filter(
      (n) => !full && !(STOREFRONT_ONLY.includes(n) && actor.permissions.has('cms:manage')),
    );
    if (blocked.length) throw forbidden(`You can't change these settings: ${blocked.join(', ')}`);

    let roundingChanged: NetPriceRounding | null = null;
    await withTransaction(async (session) => {
      const doc = await this.load(session);
      if (doc.__v !== version) {
        throw conflict(
          'VERSION_CONFLICT',
          'Settings were changed by someone else. Reload to see the latest.',
        );
      }
      const before = doc.toObject() as unknown as Record<string, unknown>;
      const paths: string[] = [];
      // Audit every leaf of the section, old and new (catches cleared fields too).
      const touch = (section: string, value: unknown) => {
        paths.push(...leafPaths(value, section), ...leafPaths(before[section], section));
      };

      if (sections.company) {
        const c = sections.company;
        doc.set('company', { ...c, logo: doc.company?.logo });
        touch('company', c);
      }
      if (sections.storefront) {
        doc.set('storefront', { ...sections.storefront, safetyPageSlug: doc.storefront?.safetyPageSlug });
        touch('storefront', sections.storefront);
      }
      if (sections.tax) {
        const { netPriceRounding, ...tax } = sections.tax;
        doc.set('tax', tax);
        if ((doc.pricing?.netPriceRounding ?? DEFAULT_NET_PRICE_ROUNDING) !== netPriceRounding) {
          roundingChanged = netPriceRounding;
        }
        doc.set('pricing.netPriceRounding', netPriceRounding);
        touch('tax', tax);
        paths.push('pricing.netPriceRounding');
      }
      if (sections.invoice) {
        doc.set('invoice', sections.invoice);
        touch('invoice', sections.invoice);
      }
      if (sections.payment) {
        doc.set('payment', { ...sections.payment, upiQrImage: doc.payment?.upiQrImage });
        touch('payment', sections.payment);
      }
      if (sections.order) {
        const { defaultLowStockThreshold, ...order } = sections.order;
        doc.set('order', order);
        doc.set('inventory.defaultLowStockThreshold', defaultLowStockThreshold);
        touch('order', order);
        paths.push('inventory.defaultLowStockThreshold');
      }
      if (sections.whatsappTemplates) {
        const current = new Map(doc.whatsappTemplates.map((t) => [t.event, t.message]));
        for (const [event, message] of Object.entries(sections.whatsappTemplates) as [
          WhatsAppEvent,
          string,
        ][]) {
          if (!message || message === DEFAULT_WHATSAPP_MESSAGES[event]) current.delete(event);
          else current.set(event, message);
        }
        doc.set(
          'whatsappTemplates',
          [...current].map(([event, message]) => ({ event, message })),
        );
        paths.push('whatsappTemplates');
      }
      doc.set('updatedBy', actor.user);
      await doc.save({ session });

      const after = doc.toObject() as unknown as Record<string, unknown>;
      const changes = diffFields(before, after, [...new Set(paths)]);
      if (changes.length) {
        await this.deps.audit.record(
          {
            actor,
            action: 'update',
            entity: 'settings',
            entityId: SETTINGS_ID,
            entityLabel: 'Store settings',
            summary: `Updated ${names.join(', ')}`,
            changes,
          },
          meta,
          session,
        );
      }
      if (roundingChanged) await this.repriceProducts(roundingChanged, actor, meta, session);
    });

    this.deps.cache.invalidate();
    if (roundingChanged) pricingContext.setRoundingMode(roundingChanged);
    return this.get();
  }

  /** Logo or UPI QR image: sanitised, stored, previous file removed after the change commits. */
  async setImage(
    kind: 'logo' | 'upiQr',
    file: Buffer,
    actor: SettingsActor,
    meta: RequestMeta,
  ): Promise<SettingsDto> {
    if (!actor.permissions.has('settings:update')) throw forbidden();
    const img = await processImage(file);
    const stored = await this.deps.storage.put({ ...img, folder: 'company' });
    const path = kind === 'logo' ? 'company.logo' : 'payment.upiQrImage';
    let oldKey: string | undefined;
    try {
      const doc = await this.load();
      oldKey = (kind === 'logo' ? doc.company?.logo?.key : doc.payment?.upiQrImage?.key) ?? undefined;
      doc.set(path, { ...stored, alt: kind === 'logo' ? doc.company?.name : 'UPI QR code' });
      doc.set('updatedBy', actor.user);
      await doc.save();
    } catch (err) {
      await this.deps.storage.remove(stored.key).catch(() => undefined);
      throw err;
    }
    if (oldKey) await this.deps.storage.remove(oldKey).catch(() => undefined);
    this.deps.cache.invalidate();
    await this.deps.audit.record(
      {
        actor,
        action: 'update',
        entity: 'settings',
        entityId: SETTINGS_ID,
        entityLabel: 'Store settings',
        summary: kind === 'logo' ? 'Logo changed' : 'UPI QR image changed',
      },
      meta,
    );
    return this.get();
  }

  async removeImage(kind: 'logo' | 'upiQr', actor: SettingsActor, meta: RequestMeta): Promise<SettingsDto> {
    if (!actor.permissions.has('settings:update')) throw forbidden();
    const doc = await this.load();
    const key = kind === 'logo' ? doc.company?.logo?.key : doc.payment?.upiQrImage?.key;
    doc.set(kind === 'logo' ? 'company.logo' : 'payment.upiQrImage', undefined);
    await doc.save();
    if (key) await this.deps.storage.remove(key).catch(() => undefined);
    this.deps.cache.invalidate();
    await this.deps.audit.record(
      {
        actor,
        action: 'update',
        entity: 'settings',
        entityId: SETTINGS_ID,
        entityLabel: 'Store settings',
        summary: kind === 'logo' ? 'Logo removed' : 'UPI QR image removed',
      },
      meta,
    );
    return this.get();
  }

  // ---------------------------------------------------------------- seasons

  async listSeasons(): Promise<SeasonDto[]> {
    const rows = await SeasonModel.find().sort({ startDate: -1 }).lean();
    const now = new Date();
    return rows.map((s) => ({
      id: String(s._id),
      name: s.name,
      festivalDate: s.festivalDate.toISOString(),
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      isCurrent: s.startDate <= now && s.endDate >= now,
    }));
  }

  async saveSeason(
    id: string | null,
    input: SeasonInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<SeasonDto[]> {
    await this.assertNoOverlap(id, input);
    if (id) {
      const s = await SeasonModel.findById(id);
      if (!s) throw notFound('Season');
      const before = s.toObject();
      s.set(input);
      await s.save();
      await this.deps.audit.record(
        {
          actor,
          action: 'update',
          entity: 'season',
          entityId: id,
          entityLabel: s.name,
          changes: diffFields(before, s.toObject(), ['name', 'festivalDate', 'startDate', 'endDate']),
        },
        meta,
      );
    } else {
      const s = await SeasonModel.create(input).catch((err: unknown) => {
        if ((err as { code?: number }).code === 11000)
          throw conflict('DUPLICATE', 'A season with this name already exists');
        throw err;
      });
      await this.deps.audit.record(
        { actor, action: 'create', entity: 'season', entityId: String(s._id), entityLabel: s.name },
        meta,
      );
    }
    return this.listSeasons();
  }

  async deleteSeason(id: string, actor: AuditActor, meta: RequestMeta): Promise<SeasonDto[]> {
    const s = await SeasonModel.findByIdAndDelete(id);
    if (!s) throw notFound('Season');
    await this.deps.audit.record(
      { actor, action: 'delete', entity: 'season', entityId: id, entityLabel: s.name },
      meta,
    );
    return this.listSeasons();
  }

  // ---------------------------------------------------------------- internals

  private async assertNoOverlap(id: string | null, input: SeasonInput): Promise<void> {
    const clash = await SeasonModel.findOne({
      ...(id ? { _id: { $ne: id } } : {}),
      startDate: { $lt: input.endDate },
      endDate: { $gt: input.startDate },
    }).lean();
    if (clash) throw conflict('CONFLICT', `Overlaps with ${clash.name}. Seasons can't overlap.`);
  }

  /** New rounding mode: recompute every product's net price (and audit it as one bulk change). */
  private async repriceProducts(
    mode: NetPriceRounding,
    actor: AuditActor,
    meta: RequestMeta,
    session: ClientSession,
  ): Promise<void> {
    const products = await ProductModel.find(
      {},
      { mrp: 1, discountPct: 1, netPrice: 1 },
      { withDeleted: true },
    )
      .session(session)
      .lean();
    const ops = products
      .map((p) => ({ id: p._id, net: computeNetPrice(p.mrp, p.discountPct, mode), was: p.netPrice }))
      .filter((p) => p.net !== p.was)
      .map((p) => ({ updateOne: { filter: { _id: p.id }, update: { $set: { netPrice: p.net } } } }));
    if (ops.length) await ProductModel.bulkWrite(ops, { session });
    await this.deps.audit.record(
      {
        actor,
        action: 'bulk_update',
        entity: 'product',
        summary: `Net prices recalculated with rounding "${mode}": ${ops.length} of ${products.length} changed`,
        meta: { netPriceRounding: mode, changed: ops.length },
      },
      meta,
      session,
    );
  }

  private async load(session?: ClientSession): Promise<SettingsDoc> {
    const doc = await SettingsModel.findById(SETTINGS_ID).session(session ?? null);
    if (doc) return doc;
    // First run without the seed: start from the schema defaults.
    const [created] = await SettingsModel.create(
      [{ _id: SETTINGS_ID, company: { name: 'Sakthimaan Crackers' } }],
      {
        session,
      },
    );
    if (!created) throw new Error('Could not create settings');
    return created;
  }

  private async toDto(doc: SettingsDoc): Promise<SettingsDto> {
    const s = doc.toObject<Settings & { __v: number; updatedAt?: Date }>();
    const c: Partial<NonNullable<Settings['company']>> = s.company ?? {};
    const inv = s.invoice;
    const fy = financialYearOf(new Date());
    const [invSeq, cnSeq] = await Promise.all([
      CounterModel.findById(counterKey('invoice', fy)).lean(),
      CounterModel.findById(counterKey('credit_note', fy)).lean(),
    ]);
    const sample = (format: string, prefix: string, seq: number) => {
      try {
        return formatDocumentNumber(format, { prefix, fy, seq });
      } catch {
        return '—';
      }
    };
    const custom = new Map((s.whatsappTemplates ?? []).map((t) => [t.event, t.message]));
    const a = c.address;
    const bank = s.payment?.bank;
    return {
      version: s.__v,
      updatedAt: iso(s.updatedAt),
      company: {
        name: c.name ?? 'Sakthimaan Crackers',
        legalName: c.legalName ?? null,
        logoUrl: c.logo?.url ?? null,
        address: a
          ? {
              line1: a.line1,
              line2: a.line2 ?? null,
              landmark: a.landmark ?? null,
              city: a.city,
              district: a.district ?? null,
              stateCode: a.stateCode,
              pincode: a.pincode,
            }
          : null,
        phones: c.phones ?? [],
        whatsappNumber: c.whatsappNumber ?? null,
        email: c.email ?? null,
        gstin: c.gstin ?? null,
        licenseNumber: c.licenseNumber ?? null,
        licenseValidTill: iso(c.licenseValidTill),
      },
      storefront: {
        isOpen: s.storefront?.isOpen ?? true,
        closedMessage: s.storefront?.closedMessage ?? null,
        orderMode: s.storefront?.orderMode ?? 'enquiry',
        announcement: {
          text: s.storefront?.announcement?.text ?? null,
          linkUrl: s.storefront?.announcement?.linkUrl ?? null,
          isActive: s.storefront?.announcement?.isActive ?? false,
        },
      },
      tax: {
        sellerStateCode: s.tax?.sellerStateCode ?? DEFAULT_SELLER_STATE_CODE,
        defaultHsn: s.tax?.defaultHsn ?? DEFAULT_HSN,
        defaultTaxRate: s.tax?.defaultTaxRate ?? DEFAULT_TAX_RATE,
        netPriceRounding: s.pricing?.netPriceRounding ?? DEFAULT_NET_PRICE_ROUNDING,
      },
      invoice: {
        prefix: inv?.prefix ?? DEFAULT_INVOICE_PREFIX,
        creditNotePrefix: inv?.creditNotePrefix ?? 'CN',
        format: inv?.format ?? DEFAULT_INVOICE_FORMAT,
        creditNoteFormat: inv?.creditNoteFormat ?? DEFAULT_CREDIT_NOTE_FORMAT,
        terms: inv?.terms ?? null,
        footerNote: inv?.footerNote ?? null,
        showUpiQr: inv?.showUpiQr ?? true,
        sampleInvoiceNo: sample(
          inv?.format ?? DEFAULT_INVOICE_FORMAT,
          inv?.prefix ?? DEFAULT_INVOICE_PREFIX,
          (invSeq?.seq ?? 0) + 1,
        ),
        sampleCreditNoteNo: sample(
          inv?.creditNoteFormat ?? DEFAULT_CREDIT_NOTE_FORMAT,
          inv?.creditNotePrefix ?? 'CN',
          (cnSeq?.seq ?? 0) + 1,
        ),
      },
      payment: {
        upiId: s.payment?.upiId ?? null,
        upiPayeeName: s.payment?.upiPayeeName ?? null,
        upiQrUrl: s.payment?.upiQrImage?.url ?? null,
        showUpiQrOnStorefront: s.payment?.showUpiQrOnStorefront ?? true,
        bank:
          bank?.accountNumber && bank.ifsc
            ? {
                accountName: bank.accountName ?? '',
                accountNumber: bank.accountNumber,
                ifsc: bank.ifsc,
                bankName: bank.bankName ?? '',
                branch: bank.branch ?? null,
              }
            : null,
        instructions: s.payment?.instructions ?? null,
      },
      order: {
        numberPrefix: s.order?.numberPrefix ?? 'ORD',
        defaultMinOrderValue: s.order?.defaultMinOrderValue ?? 0,
        packingChargePct: s.order?.packingChargePct ?? 0,
        autoCancelUnpaidCheckoutHours: s.order?.autoCancelUnpaidCheckoutHours ?? 48,
        defaultLowStockThreshold: s.inventory?.defaultLowStockThreshold ?? 10,
      },
      whatsappTemplates: Object.fromEntries(
        WHATSAPP_EVENTS.map((e) => [
          e,
          { message: custom.get(e) ?? DEFAULT_WHATSAPP_MESSAGES[e], isCustom: custom.has(e) },
        ]),
      ) as SettingsDto['whatsappTemplates'],
    };
  }
}
