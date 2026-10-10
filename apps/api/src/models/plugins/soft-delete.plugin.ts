import { Schema } from 'mongoose';

/**
 * Soft-delete fields. Spread into a schema definition (rather than added by the
 * plugin) so `InferSchemaType` sees them.
 */
export const softDeleteFields = {
  isDeleted: { type: Boolean, default: false, required: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
} as const;

const FILTERED_QUERIES = [
  'countDocuments',
  'distinct',
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
] as const;

/**
 * Adds `isDeleted: false` to every query unless the caller explicitly filters on
 * `isDeleted` or passes `{ withDeleted: true }` in query options.
 *
 * Aggregations are NOT filtered automatically: repositories must start pipelines
 * with `{ $match: { isDeleted: false } }` (enforced by the `activeMatch()` helper).
 */
export function softDeletePlugin(schema: Schema): void {
  for (const op of FILTERED_QUERIES) {
    schema.pre(op, function () {
      if (this.getOptions().withDeleted === true) return;
      if (this.getFilter().isDeleted !== undefined) return;
      this.where({ isDeleted: false });
    });
  }
}

export const activeMatch = { $match: { isDeleted: false } } as const;
