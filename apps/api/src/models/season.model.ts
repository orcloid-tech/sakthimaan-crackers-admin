import { Schema, model, type InferSchemaType } from 'mongoose';

/** Sales seasons, used for "season revenue" KPIs and this-Diwali-vs-last comparisons. */
const seasonSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 }, // "Diwali 2026"
    festivalDate: { type: Date, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true },
);

seasonSchema.pre('validate', function () {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    this.invalidate('endDate', 'endDate must be after startDate');
  }
});

seasonSchema.index({ name: 1 }, { unique: true });
seasonSchema.index({ startDate: -1 });

export type Season = InferSchemaType<typeof seasonSchema>;
export const SeasonModel = model('Season', seasonSchema);
