import type { AuditActorOption, AuditDetail, AuditListItem, AuditListQuery } from '@sakthimaan/shared';
import { AuditLogModel, type AuditLog } from '../models/index.js';
import { notFound } from '../utils/app-error.js';
import { containsRegex, oid } from '../utils/query.js';
import { istDayRange } from './reports/period.js';

type Row = AuditLog & { _id: unknown; createdAt?: Date };

function toItem(r: Row): AuditListItem {
  return {
    id: String(r._id),
    at: (r.createdAt ?? new Date(0)).toISOString(),
    actor: r.actor
      ? { userId: r.actor.user ? String(r.actor.user) : null, name: r.actor.name, role: r.actor.role ?? null }
      : null,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId ?? null,
    entityLabel: r.entityLabel ?? null,
    summary: r.summary ?? null,
    changeCount: r.changes?.length ?? 0,
  };
}

/**
 * Read-only view of the audit trail. Entries are written by services as things happen
 * and are never edited or deleted, so this service has no write methods at all.
 */
export class AuditQueryService {
  async list(q: AuditListQuery): Promise<{ items: AuditListItem[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (q.userId) filter['actor.user'] = oid(q.userId);
    if (q.action) filter.action = q.action;
    if (q.entity) filter.entity = q.entity;
    if (q.entityId) filter.entityId = q.entityId;
    if (q.from || q.to) {
      const { start, end } = istDayRange(q.from, q.to);
      filter.createdAt = { ...(q.from ? { $gte: start } : {}), ...(q.to ? { $lte: end } : {}) };
    }
    if (q.q) {
      const rx = containsRegex(q.q);
      filter.$or = [{ entityLabel: rx }, { summary: rx }, { 'actor.name': rx }];
    }
    const [rows, total] = await Promise.all([
      AuditLogModel.find(filter, {
        changes: 1,
        actor: 1,
        action: 1,
        entity: 1,
        entityId: 1,
        entityLabel: 1,
        summary: 1,
        createdAt: 1,
      })
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<Row[]>(),
      AuditLogModel.countDocuments(filter),
    ]);
    return { items: rows.map(toItem), total };
  }

  async get(id: string): Promise<AuditDetail> {
    const r = await AuditLogModel.findById(id).lean<Row>();
    if (!r) throw notFound('Audit entry');
    return {
      ...toItem(r),
      changes: (r.changes ?? []).map((c) => ({
        path: c.path,
        from: (c.from as unknown) ?? null,
        to: (c.to as unknown) ?? null,
      })),
      meta: (r.meta as Record<string, unknown> | undefined) ?? null,
      ip: r.ip ?? null,
      userAgent: r.userAgent ?? null,
      requestId: r.requestId ?? null,
    };
  }

  /** Everyone who appears in the log (for the "user" filter), most recent first. */
  async actors(): Promise<AuditActorOption[]> {
    const rows = await AuditLogModel.aggregate<{
      _id: unknown;
      name: string;
      role: string | null;
      last: Date;
    }>([
      { $match: { 'actor.user': { $ne: null } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$actor.user',
          name: { $first: '$actor.name' },
          role: { $first: '$actor.role' },
          last: { $first: '$createdAt' },
        },
      },
      { $sort: { last: -1 } },
      { $limit: 200 },
    ]);
    return rows.map((r) => ({ userId: String(r._id), name: r.name, role: r.role ?? null }));
  }
}
