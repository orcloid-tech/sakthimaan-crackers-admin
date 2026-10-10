import { Types } from 'mongoose';
import { badRequest } from './app-error.js';

/** Escapes user input for use inside a RegExp (search boxes). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" match for admin search over small collections. */
export function containsRegex(input: string): RegExp {
  return new RegExp(escapeRegex(input), 'i');
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

export const oid = (id: string) => new Types.ObjectId(id);

// ---- cursor pagination (newest first) over (createdAt, _id)

export interface CursorPosition {
  createdAt: Date;
  id: Types.ObjectId;
}

export function encodeCursor(doc: { createdAt: Date; _id: Types.ObjectId }): string {
  return Buffer.from(`${doc.createdAt.getTime()}:${doc._id.toHexString()}`).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
  const time = Number(ms);
  if (!Number.isSafeInteger(time) || !id || !Types.ObjectId.isValid(id)) {
    throw badRequest('VALIDATION_ERROR', 'Invalid cursor');
  }
  return { createdAt: new Date(time), id: new Types.ObjectId(id) };
}

/** Filter for "older than the cursor" with a (createdAt desc, _id desc) sort. */
export function beforeCursor(cursor: string | undefined): Record<string, unknown> {
  if (!cursor) return {};
  const c = decodeCursor(cursor);
  return { $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c.id } }] };
}

/** Splits a limit+1 fetch into the page and the next cursor. */
export function cursorPage<T extends { createdAt: Date; _id: Types.ObjectId }>(
  docs: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = docs.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: docs.length > limit && last ? encodeCursor(last) : null };
}
