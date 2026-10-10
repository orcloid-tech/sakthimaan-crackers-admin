import type { ClientSession } from 'mongoose';
import type { AuditAction, AuditEntity } from '@sakthimaan/shared';
import type { Logger } from '../config/logger.js';
import type { RequestMeta } from '../middlewares/request-context.js';
import { AuditLogModel } from '../models/index.js';

export interface AuditActor {
  user?: string;
  name: string;
  role?: string;
}

export interface AuditChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  actor?: AuditActor;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string;
  entityLabel?: string;
  summary?: string;
  changes?: AuditChange[];
  meta?: Record<string, unknown>;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? String(a) === String(b) : JSON.stringify(a) === JSON.stringify(b);

/** Field-level diff of the given paths (dot notation), for the audit trail. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  paths: readonly string[],
): AuditChange[] {
  const get = (obj: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((acc, key) => (isPlainObject(acc) ? acc[key] : undefined), obj);
  return paths
    .map((path) => ({ path, from: get(before, path), to: get(after, path) }))
    .filter((c) => !same(c.from, c.to));
}

/**
 * Writes the audit trail. Called explicitly by services so each entry knows the actor,
 * request id and a meaningful diff. Pass the transaction session so the audit row
 * commits or rolls back together with the change it describes.
 */
export class AuditService {
  constructor(private readonly logger: Logger) {}

  async record(entry: AuditEntry, meta?: RequestMeta, session?: ClientSession): Promise<void> {
    await AuditLogModel.create(
      [
        {
          ...entry,
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          requestId: meta?.requestId,
        },
      ],
      session ? { session } : {},
    );
  }

  /** Many entries in one insert (bulk operations, imports). */
  async recordMany(entries: AuditEntry[], meta?: RequestMeta, session?: ClientSession): Promise<void> {
    if (entries.length === 0) return;
    await AuditLogModel.insertMany(
      entries.map((e) => ({ ...e, ip: meta?.ip, userAgent: meta?.userAgent, requestId: meta?.requestId })),
      session ? { session } : {},
    );
  }

  /** For events that must never fail the request (e.g. failed-login logging). */
  async recordSafely(entry: AuditEntry, meta?: RequestMeta): Promise<void> {
    try {
      await this.record(entry, meta);
    } catch (err) {
      this.logger.error({ err, action: entry.action, entity: entry.entity }, 'Failed to write audit log');
    }
  }
}
