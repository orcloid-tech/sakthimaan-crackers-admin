import type { Types } from 'mongoose';
import {
  INDIAN_STATES,
  type CityDto,
  type CityInput,
  type IndianStateCode,
  type ServiceStateDto,
  type StateUpdateInput,
  type TransportPartnerDto,
  type TransportPartnerInput,
  type ZoneDto,
  type ZoneInput,
} from '@sakthimaan/shared';
import type { RequestMeta } from '../middlewares/request-context.js';
import { CityModel, ServiceStateModel, TransportPartnerModel, ZoneModel } from '../models/index.js';
import { conflict, notFound } from '../utils/app-error.js';
import { oid } from '../utils/query.js';
import { withTransaction } from '../utils/transaction.js';
import { diffFields, type AuditActor, type AuditService } from './audit.service.js';
import { ensureStates } from './runtime-settings.js';
import type { SettingsCache } from './settings-cache.js';

const ZONE_FIELDS = [
  'name',
  'description',
  'minOrderValue',
  'deliveryChargeMode',
  'deliveryRules',
  'estimatedDeliveryDays',
  'sortOrder',
  'isActive',
] as const;
const PARTNER_FIELDS = [
  'name',
  'contactPerson',
  'phones',
  'email',
  'trackingUrlTemplate',
  'servedStates',
  'notes',
  'sortOrder',
  'isActive',
] as const;

const duplicate = (what: string) => (err: unknown) => {
  if ((err as { code?: number }).code === 11000) throw conflict('DUPLICATE', `${what} already exists`);
  throw err;
};

/**
 * Where we deliver and on what terms: zones (minimum order, delivery charge rules,
 * delivery time), per-state serviceability and overrides, city exceptions, and the
 * transport partners used at dispatch. Order pricing reads these through OrderBuilder,
 * so changes apply to the next preview / order immediately. Every change is audited.
 */
export class ShippingService {
  constructor(private readonly deps: { audit: AuditService; settings: SettingsCache }) {}

  // ---------------------------------------------------------------- zones

  async listZones(): Promise<ZoneDto[]> {
    const [zones, states] = await Promise.all([
      ZoneModel.find().sort({ sortOrder: 1, name: 1 }).lean(),
      ServiceStateModel.find({ zone: { $ne: null } }, { code: 1, zone: 1 }).lean(),
    ]);
    return zones.map((z) => ({
      id: String(z._id),
      name: z.name,
      description: z.description ?? null,
      minOrderValue: z.minOrderValue,
      deliveryChargeMode: z.deliveryChargeMode,
      deliveryRules: z.deliveryRules.map((r) => ({
        minOrderValue: r.minOrderValue ?? 0,
        maxOrderValue: r.maxOrderValue ?? null,
        type: r.type,
        value: r.value ?? 0,
      })),
      estimatedDeliveryDays:
        z.estimatedDeliveryDays?.min != null && z.estimatedDeliveryDays.max != null
          ? { min: z.estimatedDeliveryDays.min, max: z.estimatedDeliveryDays.max }
          : null,
      sortOrder: z.sortOrder,
      isActive: z.isActive,
      stateCodes: states.filter((s) => String(s.zone) === String(z._id)).map((s) => s.code),
    }));
  }

  async saveZone(
    id: string | null,
    input: ZoneInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<ZoneDto[]> {
    if (id) {
      const zone = await ZoneModel.findById(id);
      if (!zone) throw notFound('Zone');
      const before = zone.toObject();
      zone.set({
        ...input,
        description: input.description,
        estimatedDeliveryDays: input.estimatedDeliveryDays,
      });
      await zone.save().catch(duplicate('A zone with this name'));
      await this.deps.audit.record(
        {
          actor,
          action: 'update',
          entity: 'zone',
          entityId: id,
          entityLabel: zone.name,
          changes: diffFields(before, zone.toObject(), ZONE_FIELDS),
        },
        meta,
      );
    } else {
      const zone = await ZoneModel.create(input).catch(duplicate('A zone with this name'));
      await this.deps.audit.record(
        { actor, action: 'create', entity: 'zone', entityId: String(zone._id), entityLabel: zone.name },
        meta,
      );
    }
    return this.listZones();
  }

  /** A zone in use can't be deleted: move its states to another zone first (or deactivate it). */
  async deleteZone(id: string, actor: AuditActor, meta: RequestMeta): Promise<ZoneDto[]> {
    const used = await ServiceStateModel.countDocuments({ zone: oid(id) });
    if (used)
      throw conflict('CONFLICT', `${used} state(s) are in this zone. Move them to another zone first.`);
    const zone = await ZoneModel.findByIdAndDelete(id);
    if (!zone) throw notFound('Zone');
    await this.deps.audit.record(
      { actor, action: 'delete', entity: 'zone', entityId: id, entityLabel: zone.name },
      meta,
    );
    return this.listZones();
  }

  // ---------------------------------------------------------------- states

  async listStates(): Promise<ServiceStateDto[]> {
    await ensureStates();
    const [states, zones, cityCounts, settings] = await Promise.all([
      ServiceStateModel.find().lean(),
      ZoneModel.find({}, { name: 1, minOrderValue: 1 }).lean(),
      CityModel.aggregate<{ _id: IndianStateCode; n: number }>([
        { $group: { _id: '$stateCode', n: { $sum: 1 } } },
      ]),
      this.deps.settings.get(),
    ]);
    const zoneById = new Map(zones.map((z) => [String(z._id), z]));
    const cities = new Map(cityCounts.map((c) => [c._id, c.n]));
    const byCode = new Map(states.map((s) => [s.code, s]));
    const storeMin = settings?.order?.defaultMinOrderValue ?? 0;
    // Follow the reference list's order (north to south, as on GSTINs).
    return INDIAN_STATES.map((ref) => {
      const s = byCode.get(ref.code);
      const zone = s?.zone ? zoneById.get(String(s.zone)) : undefined;
      return {
        code: ref.code,
        name: ref.name,
        gstCode: ref.gstCode,
        isUT: ref.isUT,
        isServiceable: s?.isServiceable ?? false,
        zoneId: zone ? String(zone._id) : null,
        zoneName: zone?.name ?? null,
        minOrderValue: s?.minOrderValue ?? null,
        effectiveMinOrderValue: s?.minOrderValue ?? zone?.minOrderValue ?? storeMin,
        restrictionNote: s?.restrictionNote ?? null,
        cityExceptions: cities.get(ref.code) ?? 0,
      };
    });
  }

  async updateStates(
    input: StateUpdateInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<ServiceStateDto[]> {
    await ensureStates();
    let zone: { _id: Types.ObjectId; name: string } | null = null;
    if (input.zoneId) {
      zone = await ZoneModel.findById(input.zoneId, { name: 1 }).lean();
      if (!zone) throw notFound('Zone');
    }
    const set: Record<string, unknown> = {};
    if (input.isServiceable !== undefined) set.isServiceable = input.isServiceable;
    if (input.zoneId !== undefined) set.zone = zone?._id ?? null;
    if (input.minOrderValue !== undefined) set.minOrderValue = input.minOrderValue;
    if (input.restrictionNote !== undefined) set.restrictionNote = input.restrictionNote || undefined;

    await withTransaction(async (session) => {
      const before = await ServiceStateModel.find({ code: { $in: input.codes } })
        .session(session)
        .lean();
      await ServiceStateModel.updateMany({ code: { $in: input.codes } }, { $set: set }, { session });
      const after = await ServiceStateModel.find({ code: { $in: input.codes } })
        .session(session)
        .lean();
      const prev = new Map(before.map((s) => [s.code, s]));
      const entries = after
        .map((s) => ({
          s,
          changes: diffFields(prev.get(s.code) ?? {}, s, [
            'isServiceable',
            'zone',
            'minOrderValue',
            'restrictionNote',
          ]),
        }))
        .filter((e) => e.changes.length > 0)
        .map(({ s, changes }) => ({
          actor,
          action: 'update' as const,
          entity: 'state' as const,
          entityId: s.code,
          entityLabel: s.name,
          changes,
          ...(zone ? { meta: { zoneName: zone.name } } : {}),
        }));
      await this.deps.audit.recordMany(entries, meta, session);
    });
    return this.listStates();
  }

  // ---------------------------------------------------------------- cities

  async listCities(stateCode?: IndianStateCode): Promise<CityDto[]> {
    const rows = await CityModel.find(stateCode ? { stateCode } : {})
      .sort({ stateCode: 1, nameKey: 1 })
      .lean();
    return rows.map((c) => ({
      id: String(c._id),
      stateCode: c.stateCode,
      name: c.name,
      isServiceable: c.isServiceable,
      minOrderValue: c.minOrderValue ?? null,
      restrictionNote: c.restrictionNote ?? null,
    }));
  }

  async saveCity(
    id: string | null,
    input: CityInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<CityDto[]> {
    if (id) {
      const city = await CityModel.findById(id);
      if (!city) throw notFound('City');
      const before = city.toObject();
      city.set({
        ...input,
        minOrderValue: input.minOrderValue ?? null,
        restrictionNote: input.restrictionNote,
      });
      await city.save().catch(duplicate('This city'));
      await this.deps.audit.record(
        {
          actor,
          action: 'update',
          entity: 'city',
          entityId: id,
          entityLabel: `${city.name}, ${city.stateCode}`,
          changes: diffFields(before, city.toObject(), [
            'name',
            'stateCode',
            'isServiceable',
            'minOrderValue',
            'restrictionNote',
          ]),
        },
        meta,
      );
    } else {
      const city = await CityModel.create({ ...input, minOrderValue: input.minOrderValue ?? null }).catch(
        duplicate('This city'),
      );
      await this.deps.audit.record(
        {
          actor,
          action: 'create',
          entity: 'city',
          entityId: String(city._id),
          entityLabel: `${city.name}, ${city.stateCode}`,
          summary: city.isServiceable ? 'City exception added' : 'City blocked',
        },
        meta,
      );
    }
    return this.listCities(input.stateCode);
  }

  async deleteCity(id: string, actor: AuditActor, meta: RequestMeta): Promise<CityDto[]> {
    const city = await CityModel.findByIdAndDelete(id);
    if (!city) throw notFound('City');
    await this.deps.audit.record(
      {
        actor,
        action: 'delete',
        entity: 'city',
        entityId: id,
        entityLabel: `${city.name}, ${city.stateCode}`,
      },
      meta,
    );
    return this.listCities(city.stateCode);
  }

  // ---------------------------------------------------------------- transport partners

  async listPartners(): Promise<TransportPartnerDto[]> {
    const rows = await TransportPartnerModel.find().sort({ isActive: -1, sortOrder: 1, name: 1 }).lean();
    return rows.map((t) => ({
      id: String(t._id),
      name: t.name,
      contactPerson: t.contactPerson ?? null,
      phones: t.phones,
      email: t.email ?? null,
      trackingUrlTemplate: t.trackingUrlTemplate ?? null,
      servedStates: t.servedStates,
      notes: t.notes ?? null,
      sortOrder: t.sortOrder,
      isActive: t.isActive,
    }));
  }

  async savePartner(
    id: string | null,
    input: TransportPartnerInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<TransportPartnerDto[]> {
    // Optional fields left out are cleared.
    const values = {
      contactPerson: undefined,
      email: undefined,
      trackingUrlTemplate: undefined,
      notes: undefined,
      ...input,
    };
    if (id) {
      const t = await TransportPartnerModel.findById(id);
      if (!t) throw notFound('Transport partner');
      const before = t.toObject();
      t.set(values);
      await t.save().catch(duplicate('A transport partner with this name'));
      await this.deps.audit.record(
        {
          actor,
          action: 'update',
          entity: 'transport_partner',
          entityId: id,
          entityLabel: t.name,
          changes: diffFields(before, t.toObject(), PARTNER_FIELDS),
        },
        meta,
      );
    } else {
      const t = await TransportPartnerModel.create(values).catch(
        duplicate('A transport partner with this name'),
      );
      await this.deps.audit.record(
        {
          actor,
          action: 'create',
          entity: 'transport_partner',
          entityId: String(t._id),
          entityLabel: t.name,
        },
        meta,
      );
    }
    return this.listPartners();
  }

  async deletePartner(id: string, actor: AuditActor, meta: RequestMeta): Promise<TransportPartnerDto[]> {
    // Past orders keep the transport name on their dispatch details, so deleting is safe.
    const t = await TransportPartnerModel.findByIdAndDelete(id);
    if (!t) throw notFound('Transport partner');
    await this.deps.audit.record(
      { actor, action: 'delete', entity: 'transport_partner', entityId: id, entityLabel: t.name },
      meta,
    );
    return this.listPartners();
  }
}
