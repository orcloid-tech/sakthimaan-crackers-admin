import type { RequestHandler } from 'express';

/**
 * NoSQL-injection guard, equivalent to express-mongo-sanitize, which is unmaintained
 * and breaks on Express 5 (`req.query` is a getter there).
 *
 * Removes any object key that starts with `$` or contains `.` from body, params and
 * query, recursively, so `{ "email": { "$gt": "" } }` can never reach a Mongo filter.
 * Zod validation runs afterwards and rejects anything that is not the expected shape.
 */
export function stripMongoOperators(value: unknown, depth = 0): unknown {
  if (depth > 20) return value;
  if (Array.isArray(value)) {
    return value.map((v: unknown) => stripMongoOperators(v, depth + 1));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      out[key] = stripMongoOperators(v, depth + 1);
    }
    return out;
  }
  return value;
}

export const mongoSanitize: RequestHandler = (req, _res, next) => {
  const body: unknown = req.body;
  if (body && typeof body === 'object') req.body = stripMongoOperators(body);
  req.params = stripMongoOperators(req.params) as typeof req.params;
  // Express 5 recomputes req.query on every access; pin the sanitised copy.
  const query = stripMongoOperators(req.query);
  Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
  next();
};
