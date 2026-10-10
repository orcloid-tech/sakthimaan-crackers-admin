import type { Schema } from 'mongoose';

const BLOCKED_DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;
const BLOCKED_UPDATES = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne'] as const;

/**
 * For legal documents (GST invoices, credit notes): documents can never be deleted,
 * and after creation only the whitelisted paths may change (via `doc.save()`).
 * Query-level updates are blocked entirely so nothing bypasses the check.
 */
export function immutablePlugin(schema: Schema, opts: { mutablePaths: readonly string[] }): void {
  for (const op of BLOCKED_DELETES) {
    schema.pre(op, function () {
      throw new Error(`${op} is not allowed on immutable documents`);
    });
  }
  for (const op of BLOCKED_UPDATES) {
    schema.pre(op, function () {
      throw new Error(`${op} is not allowed on immutable documents; load and save() instead`);
    });
  }
  const allowed = [...opts.mutablePaths, 'updatedAt'];
  schema.pre('save', function () {
    if (this.isNew) return;
    const illegal = this.modifiedPaths({ includeChildren: true }).filter(
      (p) => !allowed.some((m) => p === m || p.startsWith(`${m}.`)),
    );
    if (illegal.length > 0) {
      throw new Error(`Immutable document: cannot modify ${illegal.join(', ')}`);
    }
  });
}
