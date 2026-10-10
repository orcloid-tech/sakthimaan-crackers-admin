import { Schema, model, type InferSchemaType } from 'mongoose';
import { imageSchema } from './common.schemas.js';

// ---- Banners (storefront hero carousel) ----
const bannerSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 200 },
    image: { type: imageSchema, required: true },
    mobileImage: { type: imageSchema },
    linkUrl: { type: String, trim: true, maxlength: 500 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    sortOrder: { type: Number, default: 0, required: true },
    isActive: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);
bannerSchema.index({ isActive: 1, sortOrder: 1 });

// ---- FAQ ----
const faqSchema = new Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, required: true, trim: true, maxlength: 5000 },
    group: { type: String, trim: true, maxlength: 60 }, // e.g. Ordering, Delivery, Safety
    sortOrder: { type: Number, default: 0, required: true },
    isActive: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);
faqSchema.index({ isActive: 1, group: 1, sortOrder: 1 });

// ---- Static pages (safety instructions, terms, about, shipping policy) ----
const cmsPageSchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9-]+$/ },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    content: { type: String, required: true, maxlength: 100_000 }, // Markdown; sanitised on render
    seo: {
      title: { type: String, maxlength: 70 },
      description: { type: String, maxlength: 160 },
    },
    isPublished: { type: Boolean, default: false, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
cmsPageSchema.index({ slug: 1 }, { unique: true });

export type Banner = InferSchemaType<typeof bannerSchema>;
export type Faq = InferSchemaType<typeof faqSchema>;
export type CmsPage = InferSchemaType<typeof cmsPageSchema>;
export const BannerModel = model('Banner', bannerSchema);
export const FaqModel = model('Faq', faqSchema);
export const CmsPageModel = model('CmsPage', cmsPageSchema);
