import type { DeliveryChargeMode, DeliveryChargeType, OrderMode, PaymentMethod } from './enums.js';
import type { NetPriceRounding, Paise } from './money.js';
import type { WhatsAppEvent } from './schemas/order.schemas.js';
import type { IndianStateCode } from './states.js';

/** API response shapes for Settings, Shipping and Customers. Amounts in paise. */

export interface AddressDto {
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  district: string | null;
  stateCode: IndianStateCode;
  pincode: string;
}

/** One thing still to fill in under Settings, and what it holds up. */
export interface SetupItem {
  key: string;
  label: string;
  /** Settings tab where it is entered. */
  tab: 'company' | 'store' | 'billing' | 'payments' | 'orders' | 'shipping';
  /** "orders": no order can be priced without it; "invoices": invoices can't be issued; "recommended": shown to customers. */
  blocks: 'orders' | 'invoices' | 'recommended';
}

export interface SetupStatus {
  ordersReady: boolean;
  invoicesReady: boolean;
  missing: SetupItem[];
}

export interface SettingsDto {
  version: number;
  updatedAt: string | null;
  company: {
    name: string | null;
    legalName: string | null;
    logoUrl: string | null;
    address: AddressDto | null;
    phones: string[];
    whatsappNumber: string | null;
    email: string | null;
    gstin: string | null;
    licenseNumber: string | null;
    licenseValidTill: string | null;
  };
  storefront: {
    isOpen: boolean;
    closedMessage: string | null;
    orderMode: OrderMode;
    announcement: { text: string | null; linkUrl: string | null; isActive: boolean };
    messages: { enquiryReceived: string | null; checkoutConfirmed: string | null };
  };
  tax: {
    sellerStateCode: IndianStateCode | null;
    defaultHsn: string | null;
    defaultTaxRate: number | null;
    netPriceRounding: NetPriceRounding;
  };
  invoice: {
    prefix: string | null;
    creditNotePrefix: string;
    format: string;
    creditNoteFormat: string;
    terms: string | null;
    footerNote: string | null;
    showUpiQr: boolean;
    /** What the next numbers would look like (not reserved). */
    sampleInvoiceNo: string | null;
    sampleCreditNoteNo: string | null;
  };
  payment: {
    upiId: string | null;
    upiPayeeName: string | null;
    upiQrUrl: string | null;
    showUpiQrOnStorefront: boolean;
    acceptedMethods: PaymentMethod[];
    bank: {
      accountName: string;
      accountNumber: string;
      ifsc: string;
      bankName: string;
      branch: string | null;
    } | null;
    instructions: string | null;
  };
  order: {
    numberPrefix: string;
    defaultMinOrderValue: Paise;
    packingChargePct: number;
    autoCancelUnpaidCheckoutHours: number;
    defaultLowStockThreshold: number;
  };
  /** Saved message per event; null = none (that WhatsApp button is disabled). */
  whatsappTemplates: Record<WhatsAppEvent, string | null>;
  documents: { priceListNote: string | null; priceListFooter: string | null; packingSlipNote: string | null };
  setup: SetupStatus;
}

/** Settings every signed-in user may read (product form preview, defaults). */
export interface RuntimeSettingsDto {
  companyName: string | null;
  logoUrl: string | null;
  netPriceRounding: NetPriceRounding;
  defaultHsn: string | null;
  defaultTaxRate: number | null;
  sellerStateCode: IndianStateCode | null;
  acceptedMethods: PaymentMethod[];
  setup: SetupStatus;
  defaultLowStockThreshold: number;
  isOpen: boolean;
  orderMode: OrderMode;
}

export interface SeasonDto {
  id: string;
  name: string;
  festivalDate: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

// ------------------------------------------------------------------ shipping

export interface DeliveryRuleDto {
  minOrderValue: Paise;
  maxOrderValue: Paise | null;
  type: DeliveryChargeType;
  value: number;
}

export interface ZoneDto {
  id: string;
  name: string;
  description: string | null;
  minOrderValue: Paise;
  deliveryChargeMode: DeliveryChargeMode;
  deliveryRules: DeliveryRuleDto[];
  estimatedDeliveryDays: { min: number; max: number } | null;
  sortOrder: number;
  isActive: boolean;
  stateCodes: IndianStateCode[];
}

export interface ServiceStateDto {
  code: IndianStateCode;
  name: string;
  gstCode: string;
  isUT: boolean;
  isServiceable: boolean;
  zoneId: string | null;
  zoneName: string | null;
  minOrderValue: Paise | null;
  /** What actually applies: state override, else zone, else store default. */
  effectiveMinOrderValue: Paise;
  restrictionNote: string | null;
  cityExceptions: number;
}

export interface CityDto {
  id: string;
  stateCode: IndianStateCode;
  name: string;
  isServiceable: boolean;
  minOrderValue: Paise | null;
  restrictionNote: string | null;
}

export interface TransportPartnerDto {
  id: string;
  name: string;
  contactPerson: string | null;
  phones: string[];
  email: string | null;
  trackingUrlTemplate: string | null;
  servedStates: IndianStateCode[];
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
}

// ------------------------------------------------------------------ customers

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  stateCode: IndianStateCode | null;
  orderCount: number;
  totalSpent: Paise;
  lastOrderAt: string | null;
  isBlocked: boolean;
  creditAllowed: boolean;
  tags: string[];
}

export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  gstin: string | null;
  notes: string | null;
  tags: string[];
  addresses: { id: string; label: string | null; isDefault: boolean; address: AddressDto }[];
  creditAllowed: boolean;
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  stats: {
    orderCount: number;
    totalSpent: Paise;
    lastOrderAt: string | null;
    /** Still to be paid on confirmed (not cancelled) orders. */
    outstanding: Paise;
    openEnquiries: number;
  };
  createdAt: string;
}
