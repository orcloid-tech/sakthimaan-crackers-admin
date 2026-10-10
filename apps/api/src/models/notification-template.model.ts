import { Schema, model, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from '@sakthimaan/shared';

/**
 * Message template per (event, channel). Body uses {{placeholders}} such as
 * {{customerName}}, {{orderNo}}, {{grandTotal}}, {{lrNumber}}, {{trackingUrl}}.
 * WhatsApp Business requires pre-approved templates, referenced by providerTemplateId.
 */
const notificationTemplateSchema = new Schema(
  {
    event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
    subject: { type: String, trim: true, maxlength: 200 }, // email only
    body: { type: String, required: true, maxlength: 4000 },
    providerTemplateId: { type: String, trim: true },
    isActive: { type: Boolean, default: false, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

notificationTemplateSchema.index({ event: 1, channel: 1 }, { unique: true });

export type NotificationTemplate = InferSchemaType<typeof notificationTemplateSchema>;
export const NotificationTemplateModel = model('NotificationTemplate', notificationTemplateSchema);
