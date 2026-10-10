/**
 * Domain enums shared by API (Mongoose schemas, Zod validators) and admin UI.
 * Each enum is a readonly tuple so it can feed both `z.enum()` and Mongoose `enum`.
 */

export const PRODUCT_TYPES = ['single', 'combo'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_UNITS = ['box', 'pkt', 'piece'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const SOUND_LEVELS = ['none', 'low', 'medium', 'high', 'very_high'] as const;
export type SoundLevel = (typeof SOUND_LEVELS)[number];

export const STOCK_MOVEMENT_TYPES = [
  'stock_in', // purchase / production receipt
  'stock_out', // manual removal (damage, sample, return to supplier)
  'adjustment', // physical count correction (absolute set, stored as delta)
  'order_deduct', // order confirmed
  'order_restock', // confirmed order cancelled / item removed
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const ORDER_MODES = ['enquiry', 'checkout'] as const;
export type OrderMode = (typeof ORDER_MODES)[number];

export const ORDER_SOURCES = ['storefront', 'admin', 'phone', 'whatsapp'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** No payment gateway for now: payments are recorded manually (UPI / bank / cash) with a reference. */
export const PAYMENT_METHODS = ['upi', 'bank_transfer', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * submitted: proof sent by the customer from the website, awaiting verification (not counted)
 * recorded:  entered or verified by staff (counted in amountPaid)
 * rejected:  submitted proof that staff could not match
 * voided:    recorded in error, reversed with a reason
 */
export const PAYMENT_RECORD_STATUSES = ['submitted', 'recorded', 'rejected', 'voided'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** Gift boxes: `own` = factory pre-packed with their own stock. `components` is reserved (not implemented). */
export const COMBO_STOCK_MODES = ['own', 'components'] as const;
export type ComboStockMode = (typeof COMBO_STOCK_MODES)[number];

/** An issued invoice is never edited or deleted; it becomes `cancelled` only via a credit note. */
export const INVOICE_STATUSES = ['issued', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const ORDER_ACTIVITY_TYPES = [
  'status_change',
  'items_edited',
  'payment_submitted',
  'payment_recorded',
  'payment_rejected',
  'payment_voided',
  'dispatch_updated',
  'invoice_generated',
  'credit_note_issued',
  'packed_on_credit',
  'notification_sent',
  'note', // visible on order (e.g. customer instructions)
  'internal_comment', // staff-only
] as const;
export type OrderActivityType = (typeof ORDER_ACTIVITY_TYPES)[number];

export const COUPON_TYPES = ['flat', 'percent'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/** How delivery is charged. `to_pay` = customer pays transport at destination (very common). */
export const DELIVERY_CHARGE_MODES = ['to_pay', 'prepaid'] as const;
export type DeliveryChargeMode = (typeof DELIVERY_CHARGE_MODES)[number];

export const DELIVERY_CHARGE_TYPES = ['flat', 'percent', 'free'] as const;
export type DeliveryChargeType = (typeof DELIVERY_CHARGE_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_EVENTS = [
  'order_received',
  'order_confirmed',
  'payment_received',
  'order_packed',
  'order_dispatched',
  'order_delivered',
  'order_cancelled',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'restore',
  'status_change',
  'price_change',
  'stock_change',
  'bulk_update',
  'import',
  'login',
  'login_failed',
  'logout',
  'password_reset',
  'block',
  'unblock',
  'pack_unpaid', // confirmed → packed before payment (credit customer)
  'credit_change', // customer creditAllowed toggled
  'issue', // invoice / credit note issued
  'activate', // draft product made live (needs price authority)
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITIES = [
  'user',
  'product',
  'category',
  'stock',
  'order',
  'payment',
  'invoice',
  'credit_note',
  'customer',
  'coupon',
  'zone',
  'state',
  'city',
  'transport_partner',
  'banner',
  'faq',
  'cms_page',
  'notification_template',
  'season',
  'settings',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Cloudinary in production; local disk for development. Both sit behind the StorageProvider interface. */
export const STORAGE_PROVIDERS = ['cloudinary', 'local'] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];
