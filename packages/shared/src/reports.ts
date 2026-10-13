import type { AuditAction, AuditEntity, PaymentMethod, StockMovementType } from './enums.js';
import type { Paise } from './money.js';
import type { OrderStatus } from './order-workflow.js';
import type { IndianStateCode } from './states.js';

/** API response shapes for the audit log and reports. Amounts in paise. */

// ------------------------------------------------------------------ audit log

export interface AuditListItem {
  id: string;
  at: string;
  actor: { userId: string | null; name: string; role: string | null } | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string | null;
  entityLabel: string | null;
  summary: string | null;
  changeCount: number;
}

export interface AuditDetail extends AuditListItem {
  changes: { path: string; from: unknown; to: unknown }[];
  meta: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditActorOption {
  userId: string;
  name: string;
  role: string | null;
}

// ------------------------------------------------------------------ reports

/** The period a report covers (IST calendar days) and the financial year it falls in. */
export interface ReportPeriod {
  from: string;
  to: string;
  financialYear: string;
  generatedAt: string;
  storeName: string | null;
}

export interface SalesReport {
  period: ReportPeriod;
  rows: { date: string; orders: number; sales: Paise; avgOrderValue: Paise }[];
  totals: { orders: number; sales: Paise; avgOrderValue: Paise; days: number };
}

export interface ProductSalesReport {
  period: ReportPeriod;
  products: {
    productId: string;
    sku: string;
    name: string;
    category: string;
    qty: number;
    amount: Paise;
    orders: number;
  }[];
  categories: { name: string; qty: number; amount: Paise; orders: number }[];
  totals: { qty: number; amount: Paise; products: number };
}

export interface StateSalesReport {
  period: ReportPeriod;
  rows: {
    stateCode: IndianStateCode;
    stateName: string;
    orders: number;
    sales: Paise;
    avgOrderValue: Paise;
  }[];
  totals: { orders: number; sales: Paise; states: number };
}

export interface GstTaxTotals {
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  total: Paise;
}

export interface GstDocumentRow extends GstTaxTotals {
  id: string;
  number: string;
  date: string;
  orderId: string;
  orderNo: string;
  buyerName: string;
  buyerGstin: string | null;
  placeOfSupply: IndianStateCode;
  isInterState: boolean;
  /** Credit notes only. */
  invoiceNumber?: string;
  invoiceDate?: string;
  reason?: string | null;
}

export interface GstReport {
  period: ReportPeriod;
  sellerGstin: string | null;
  /** B2C (large) limit from Settings: inter-state, unregistered invoices above it go to b2cl. */
  b2clThreshold: Paise | null;
  invoices: GstDocumentRow[];
  creditNotes: GstDocumentRow[];
  /** HSN-wise, credit notes netted off. */
  hsn: (GstTaxTotals & { hsn: string; taxRate: number; qty: number; uqc: string })[];
  /** Each document split by GST rate (as GSTR-1 lists them). */
  rateLines: (Omit<GstTaxTotals, 'total' | 'totalTax'> & {
    kind: 'invoice' | 'credit_note';
    number: string;
    taxRate: number;
  })[];
  /** Rate-wise, credit notes netted off. */
  rates: (GstTaxTotals & { taxRate: number })[];
  totals: {
    invoices: GstTaxTotals & { count: number };
    creditNotes: GstTaxTotals & { count: number };
    net: GstTaxTotals;
  };
}

export interface PaymentsReport {
  period: ReportPeriod;
  byMethod: {
    method: PaymentMethod;
    payments: number;
    received: Paise;
    refunds: number;
    refunded: Paise;
    net: Paise;
  }[];
  payments: {
    id: string;
    paidAt: string;
    orderId: string;
    orderNo: string;
    customer: string;
    kind: 'payment' | 'refund';
    method: PaymentMethod;
    reference: string | null;
    amount: Paise;
    recordedBy: string | null;
  }[];
  voided: {
    id: string;
    voidedAt: string | null;
    orderId: string;
    orderNo: string;
    method: PaymentMethod;
    reference: string | null;
    amount: Paise;
    reason: string | null;
    voidedBy: string | null;
  }[];
  /** As of now (not limited to the period): confirmed orders with money still due. */
  outstanding: {
    orderId: string;
    orderNo: string;
    customer: string;
    phone: string;
    status: OrderStatus;
    confirmedAt: string | null;
    total: Paise;
    paid: Paise;
    due: Paise;
  }[];
  totals: { received: Paise; refunded: Paise; net: Paise; voided: Paise; outstanding: Paise };
}

export interface DispatchReport {
  period: ReportPeriod;
  byPartner: { transportName: string; orders: number; boxes: number }[];
  rows: {
    orderId: string;
    orderNo: string;
    dispatchDate: string;
    customer: string;
    city: string;
    stateCode: IndianStateCode;
    transportName: string;
    lrNumber: string;
    boxes: number;
    weightKg: number | null;
    status: OrderStatus;
  }[];
  totals: { orders: number; boxes: number };
}

export interface StockReport {
  period: ReportPeriod;
  rows: {
    productId: string;
    sku: string;
    name: string;
    category: string;
    type: 'single' | 'combo';
    stock: number;
    netPrice: Paise;
    value: Paise;
    isLow: boolean;
    isActive: boolean;
    movements: Record<StockMovementType, number>;
  }[];
  totals: { products: number; units: number; value: Paise; movedIn: number; movedOut: number };
}

/**
 * GST Unit Quantity Codes (GSTR-1 HSN summary) for our units; a mix of units under one
 * HSN is reported as OTH (others).
 */
export const UQC_BY_UNIT: Readonly<Record<string, string>> = { box: 'BOX', pkt: 'PAC', piece: 'PCS' };

export type ReportData =
  | SalesReport
  | ProductSalesReport
  | StateSalesReport
  | GstReport
  | PaymentsReport
  | DispatchReport
  | StockReport;
