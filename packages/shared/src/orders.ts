import type {
  DeliveryChargeMode,
  OrderActivityType,
  OrderMode,
  OrderSource,
  PaymentKind,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  ProductUnit,
} from './enums.js';
import type { Paise } from './money.js';
import type { OrderStatus } from './order-workflow.js';
import type { IndianStateCode } from './states.js';
import type { WhatsAppEvent } from './schemas/order.schemas.js';

/** API response shapes for orders (admin). Amounts in paise. */

export interface OrderListItem {
  id: string;
  orderNo: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  mode: OrderMode;
  source: OrderSource;
  customer: { id: string; name: string; phone: string };
  city: string;
  stateCode: IndianStateCode;
  itemCount: number;
  totalQty: number;
  grandTotal: Paise;
  amountPaid: Paise;
  lrNumber: string | null;
  invoiceNumber: string | null;
  createdAt: string;
}

export interface OrderLineDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  type: 'single' | 'combo';
  categoryName: string;
  unit: ProductUnit;
  contentsCount: number;
  isGreen: boolean;
  hsn: string;
  taxRate: number;
  mrp: Paise;
  discountPct: number;
  netPrice: Paise;
  qty: number;
  lineTotal: Paise;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

export interface OrderPricingDto {
  mrpTotal: Paise;
  productDiscount: Paise;
  subtotal: Paise;
  couponCode: string | null;
  couponDiscount: Paise;
  deliveryCharge: Paise;
  deliveryChargeMode: DeliveryChargeMode;
  packingCharge: Paise;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  grossTotal: Paise;
  roundOff: Paise;
  grandTotal: Paise;
  isInterState: boolean;
  placeOfSupply: IndianStateCode;
}

export interface PaymentDto {
  id: string;
  kind: PaymentKind;
  amount: Paise;
  method: PaymentMethod;
  reference: string | null;
  paidAt: string;
  status: PaymentRecordStatus;
  source: 'staff' | 'customer';
  notes: string | null;
  screenshotUrl: string | null;
  recordedBy: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface OrderActivityDto {
  id: string;
  type: OrderActivityType;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  message: string | null;
  isInternal: boolean;
  actor: string | null;
  createdAt: string;
}

export interface OrderDto {
  id: string;
  version: number;
  orderNo: string;
  status: OrderStatus;
  mode: OrderMode;
  source: OrderSource;
  paymentStatus: PaymentStatus;
  amountPaid: Paise;
  balanceDue: Paise;
  packedOnCredit: boolean;
  customer: {
    id: string;
    name: string;
    phone: string;
    altPhone: string | null;
    email: string | null;
    gstin: string | null;
    creditAllowed: boolean;
    isBlocked: boolean;
  };
  shippingAddress: {
    line1: string;
    line2: string | null;
    landmark: string | null;
    city: string;
    district: string | null;
    stateCode: IndianStateCode;
    pincode: string;
  };
  zoneName: string | null;
  items: OrderLineDto[];
  pricing: OrderPricingDto;
  customerNotes: string | null;
  dispatch: {
    transportPartnerId: string | null;
    transportName: string | null;
    lrNumber: string | null;
    dispatchDate: string | null;
    boxes: number | null;
    weightKg: number | null;
    destination: string | null;
    trackingUrl: string | null;
    deliveredAt: string | null;
  };
  invoice: { id: string; number: string; issuedAt: string } | null;
  creditNotes: { id: string; number: string; issuedAt: string }[];
  cancelReason: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  payments: PaymentDto[];
  activity: OrderActivityDto[];
}

/** A line that could not be fulfilled when confirming. */
export interface ShortageItem {
  productId: string;
  sku: string;
  name: string;
  requested: number;
  available: number;
  shortBy: number;
}

export interface Serviceability {
  serviceable: boolean;
  reason: string | null;
  minOrderValue: Paise;
  zoneName: string | null;
  deliveryChargeMode: DeliveryChargeMode;
  estimatedDays: { min: number; max: number } | null;
}

export interface PricingPreview {
  items: Pick<
    OrderLineDto,
    'productId' | 'sku' | 'name' | 'unit' | 'mrp' | 'discountPct' | 'netPrice' | 'qty' | 'lineTotal'
  >[];
  pricing: OrderPricingDto;
  serviceability: Serviceability;
  meetsMinimum: boolean;
  unavailable: { productId: string; reason: string }[];
  shortages: ShortageItem[];
}

export interface PublicOrderResult {
  orderNo: string;
  status: OrderStatus;
  grandTotal: Paise;
  /** The store's confirmation text from Settings; null if none is set. */
  message: string | null;
  payment: { upiId: string | null; upiUri: string | null } | null;
}

export interface DashboardSummary {
  generatedAt: string;
  today: { sales: Paise; collected: Paise; orders: number };
  season: { name: string | null; from: string; to: string; sales: Paise; collected: Paise; orders: number };
  lastSeason: { name: string; sales: Paise; orders: number; toSameDay: Paise } | null;
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  pendingEnquiries: number;
  awaitingPayment: { orders: number; amount: Paise };
  daily: { date: string; sales: Paise; orders: number }[];
  topProducts: { productId: string; name: string; sku: string; qty: number; sales: Paise }[];
  byCategory: { name: string; sales: Paise }[];
  byState: { stateCode: IndianStateCode; orders: number; sales: Paise }[];
}

/**
 * Starter WhatsApp messages: copied into Settings once when the store is first set up (and
 * offered as "starter text" in the editor). The app only ever sends what is in Settings. Placeholders: {{name}}, {{orderNo}}, {{total}}, {{due}}, {{upiId}},
 * {{transport}}, {{lr}}, {{boxes}}, {{store}}, {{reason}}.
 */
/** Starter texts for the website and documents, copied into Settings once (then editable). */
export const STARTER_TEXTS = {
  enquiryReceived:
    'Thank you! We have received your enquiry. Our team will call you to confirm the list and the total.',
  checkoutConfirmed:
    'Thank you! Your order is confirmed. Please pay using the UPI details below and send us the screenshot.',
  priceListNote: 'Write quantities in the Qty column and send us a photo, or call us.',
  priceListFooter:
    'GREEN = green cracker (reduced emission). Please follow the safety instructions on each pack. Not for sale to children.',
  packingSlipNote:
    'FIREWORKS: handle with care. Keep away from fire and heat. Do not stack heavy goods on top.',
  invoiceFooter: 'This is a computer-generated document.',
} as const;

export const DEFAULT_WHATSAPP_MESSAGES: Record<WhatsAppEvent, string> = {
  order_received:
    'Vanakkam {{name}}, thank you for your enquiry {{orderNo}} with {{store}}. Our team will call you shortly to confirm the list and total.',
  order_confirmed:
    'Hi {{name}}, your order {{orderNo}} is confirmed. Total: {{total}}. Please pay {{due}} to UPI {{upiId}} and share the screenshot here.',
  payment_reminder:
    'Hi {{name}}, a gentle reminder: {{due}} is pending for order {{orderNo}}. UPI: {{upiId}}. Please share the payment screenshot once paid.',
  payment_received:
    'Hi {{name}}, we received your payment for order {{orderNo}}. Thank you! We are packing your order.',
  order_packed:
    'Hi {{name}}, your order {{orderNo}} is packed ({{boxes}} box(es)) and will be dispatched soon.',
  order_dispatched:
    'Hi {{name}}, your order {{orderNo}} has been dispatched via {{transport}}. LR number: {{lr}}, {{boxes}} box(es). Please collect it from the transport office.',
  order_delivered:
    'Hi {{name}}, your order {{orderNo}} has been delivered. Happy Diwali from {{store}}! Please light safely.',
  order_cancelled:
    'Hi {{name}}, your order {{orderNo}} has been cancelled. {{reason}} Please call us if you have any questions.',
};
