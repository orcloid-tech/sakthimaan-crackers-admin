import {
  STOCK_COMMITTED_STATUSES,
  type CustomerDto,
  type CustomerListItem,
  type CustomerListQuery,
  type CustomerUpdateInput,
} from '@sakthimaan/shared';
import type { RequestMeta } from '../middlewares/request-context.js';
import { CustomerModel, OrderModel, type CustomerDocument } from '../models/index.js';
import { conflict, notFound } from '../utils/app-error.js';
import { containsRegex, escapeRegex, oid } from '../utils/query.js';
import { diffFields, type AuditActor, type AuditService } from './audit.service.js';

const SORTS: Record<CustomerListQuery['sort'], Record<string, 1 | -1>> = {
  recent: { 'stats.lastOrderAt': -1, _id: -1 },
  spend: { 'stats.totalSpent': -1, _id: -1 },
  orders: { 'stats.orderCount': -1, _id: -1 },
  name: { name: 1, _id: 1 },
  created: { createdAt: -1, _id: -1 },
};

const DETAIL_FIELDS = ['name', 'phone', 'altPhone', 'email', 'gstin', 'notes', 'tags', 'addresses'] as const;

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Customers are created by orders (matched by mobile number) and managed here.
 * Blocking and credit are separate actions with their own permissions, and every
 * change is audited. Orders keep their own snapshot of the customer's details, so
 * editing a customer never changes a past order or invoice.
 */
export class CustomerService {
  constructor(private readonly deps: { audit: AuditService }) {}

  async list(q: CustomerListQuery): Promise<{ items: CustomerListItem[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (q.status === 'blocked') filter.isBlocked = true;
    if (q.status === 'credit') filter.creditAllowed = true;
    if (q.stateCode) filter['addresses.address.stateCode'] = q.stateCode;
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      const rx = containsRegex(q.q);
      filter.$or = [
        { name: rx },
        { email: rx },
        { gstin: rx },
        { tags: rx },
        ...(digits.length >= 3
          ? [{ phone: new RegExp(escapeRegex(digits)) }, { altPhone: new RegExp(escapeRegex(digits)) }]
          : []),
      ];
    }
    const [rows, total] = await Promise.all([
      CustomerModel.find(filter)
        .sort(SORTS[q.sort])
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      CustomerModel.countDocuments(filter),
    ]);
    return {
      total,
      items: rows.map((c) => {
        const a = (c.addresses.find((x) => x.isDefault) ?? c.addresses[0])?.address;
        return {
          id: String(c._id),
          name: c.name,
          phone: c.phone,
          city: a?.city ?? null,
          stateCode: a?.stateCode ?? null,
          orderCount: c.stats?.orderCount ?? 0,
          totalSpent: c.stats?.totalSpent ?? 0,
          lastOrderAt: iso(c.stats?.lastOrderAt),
          isBlocked: c.isBlocked,
          creditAllowed: c.creditAllowed,
          tags: c.tags,
        };
      }),
    };
  }

  async get(id: string): Promise<CustomerDto> {
    const c = await CustomerModel.findById(id);
    if (!c) throw notFound('Customer');
    const [due] = await OrderModel.aggregate<{ outstanding: number }>([
      { $match: { customer: c._id, isDeleted: false, status: { $in: [...STOCK_COMMITTED_STATUSES] } } },
      {
        $group: {
          _id: null,
          outstanding: { $sum: { $max: [0, { $subtract: ['$pricing.grandTotal', '$amountPaid'] }] } },
        },
      },
    ]);
    const openEnquiries = await OrderModel.countDocuments({ customer: c._id, status: 'enquiry' });
    return this.toDto(c, due?.outstanding ?? 0, openEnquiries);
  }

  async update(
    id: string,
    input: CustomerUpdateInput,
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<CustomerDto> {
    const c = await CustomerModel.findById(id);
    if (!c) throw notFound('Customer');
    if (input.phone && input.phone !== c.phone) {
      const other = await CustomerModel.findOne(
        { phone: input.phone, _id: { $ne: c._id } },
        { name: 1 },
      ).lean();
      if (other) throw conflict('DUPLICATE', `${input.phone} already belongs to ${other.name}`);
    }
    const before = c.toObject();
    const { addresses, ...fields } = input;
    for (const [k, v] of Object.entries(fields)) c.set(k, v ?? undefined);
    if (addresses) {
      // Exactly one default address (the first one marked, else the first).
      const firstDefault = Math.max(
        0,
        addresses.findIndex((a) => a.isDefault),
      );
      c.set(
        'addresses',
        addresses.map((a, i) => ({ ...a, isDefault: i === firstDefault })),
      );
    }
    await c.save().catch((err: unknown) => {
      if ((err as { code?: number }).code === 11000)
        throw conflict('DUPLICATE', 'That mobile number is already used');
      throw err;
    });
    const changes = diffFields(before, c.toObject(), DETAIL_FIELDS).map((ch) =>
      ch.path === 'addresses'
        ? { ...ch, from: `${before.addresses.length} address(es)`, to: `${c.addresses.length} address(es)` }
        : ch,
    );
    if (changes.length) {
      await this.deps.audit.record(
        { actor, action: 'update', entity: 'customer', entityId: id, entityLabel: c.name, changes },
        meta,
      );
    }
    return this.get(id);
  }

  async setBlocked(
    id: string,
    input: { blocked: boolean; reason?: string },
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<CustomerDto> {
    const c = await CustomerModel.findById(id);
    if (!c) throw notFound('Customer');
    if (c.isBlocked === input.blocked) return this.get(id);
    c.isBlocked = input.blocked;
    c.set('blockedReason', input.blocked ? input.reason : undefined);
    c.set('blockedAt', input.blocked ? new Date() : undefined);
    c.set('blockedBy', input.blocked && actor.user ? oid(actor.user) : undefined);
    await c.save();
    await this.deps.audit.record(
      {
        actor,
        action: input.blocked ? 'block' : 'unblock',
        entity: 'customer',
        entityId: id,
        entityLabel: c.name,
        summary: input.blocked ? `Blocked: ${input.reason ?? ''}` : 'Unblocked',
      },
      meta,
    );
    return this.get(id);
  }

  /** Credit lets orders be packed before payment (by users with orders:pack_unpaid). */
  async setCredit(
    id: string,
    input: { creditAllowed: boolean; reason?: string },
    actor: AuditActor,
    meta: RequestMeta,
  ): Promise<CustomerDto> {
    const c = await CustomerModel.findById(id);
    if (!c) throw notFound('Customer');
    if (c.creditAllowed === input.creditAllowed) return this.get(id);
    c.creditAllowed = input.creditAllowed;
    await c.save();
    await this.deps.audit.record(
      {
        actor,
        action: 'credit_change',
        entity: 'customer',
        entityId: id,
        entityLabel: c.name,
        summary: `${input.creditAllowed ? 'Credit allowed' : 'Credit withdrawn'}${input.reason ? `: ${input.reason}` : ''}`,
        changes: [{ path: 'creditAllowed', from: !input.creditAllowed, to: input.creditAllowed }],
      },
      meta,
    );
    return this.get(id);
  }

  private toDto(c: CustomerDocument, outstanding: number, openEnquiries: number): CustomerDto {
    return {
      id: String(c._id),
      name: c.name,
      phone: c.phone,
      altPhone: c.altPhone ?? null,
      email: c.email ?? null,
      gstin: c.gstin ?? null,
      notes: c.notes ?? null,
      tags: [...c.tags],
      addresses: c.addresses.map((a) => ({
        id: String(a._id),
        label: a.label ?? null,
        isDefault: a.isDefault ?? false,
        address: {
          line1: a.address.line1,
          line2: a.address.line2 ?? null,
          landmark: a.address.landmark ?? null,
          city: a.address.city,
          district: a.address.district ?? null,
          stateCode: a.address.stateCode,
          pincode: a.address.pincode,
        },
      })),
      creditAllowed: c.creditAllowed,
      isBlocked: c.isBlocked,
      blockedReason: c.blockedReason ?? null,
      blockedAt: iso(c.blockedAt),
      stats: {
        orderCount: c.stats?.orderCount ?? 0,
        totalSpent: c.stats?.totalSpent ?? 0,
        lastOrderAt: iso(c.stats?.lastOrderAt),
        outstanding,
        openEnquiries,
      },
      createdAt: c.get('createdAt').toISOString(),
    };
  }
}
