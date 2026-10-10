import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { HSN_REGEX } from '@sakthimaan/shared';
import { imageSchema } from './common.schemas.js';
import { softDeleteFields, softDeletePlugin } from './plugins/soft-delete.plugin.js';

/**
 * Two-level tree: top-level categories (parent = null) and sub-categories,
 * e.g. Sparklers > 7cm Electric, Rockets > Lunik Rocket.
 */
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    description: { type: String, trim: true, maxlength: 1000 },
    image: { type: imageSchema },
    // Tax overrides; null = inherit from settings. Products inherit from here unless overridden.
    hsn: { type: String, trim: true, match: HSN_REGEX, default: null },
    taxRate: { type: Number, min: 0, max: 28, default: null },
    sortOrder: { type: Number, default: 0, required: true },
    isActive: { type: Boolean, default: true, required: true },
    ...softDeleteFields,
  },
  { timestamps: true },
);

categorySchema.plugin(softDeletePlugin);
categorySchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
categorySchema.index({ parent: 1, sortOrder: 1 });
categorySchema.index({ isActive: 1, sortOrder: 1 });

export type Category = InferSchemaType<typeof categorySchema>;
export type CategoryDocument = HydratedDocument<Category>;
export const CategoryModel = model('Category', categorySchema);
