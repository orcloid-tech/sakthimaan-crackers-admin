/**
 * Storefront API contract: types for every /api/v1/public endpoint plus a small typed
 * fetch client for the customer website (sakthimaan-crackers repo).
 *
 * This file is SELF-CONTAINED (no imports) so the website can copy it verbatim:
 *   npm run storefront:client   (writes docs/storefront-client.ts)
 * The admin API is type-checked against these same types, so they can't drift.
 *
 * Money: integer paise (₹1 = 100). Dates: ISO 8601 strings (UTC).
 */

type Paise = number;
type StateCode = string; // ISO 3166-2:IN, e.g. "TN", "KA"

// ------------------------------------------------------------------ envelope & errors

export interface StorefrontSuccess<T, M = undefined> {
  success: true;
  data: T;
  meta?: M;
}

export interface StorefrontFailure {
  success: false;
  // `string & {}` keeps the known codes in autocomplete while allowing new ones.
  error: { code: StorefrontErrorCode | (string & {}); message: string; details?: unknown };
}

export type StorefrontErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CAPTCHA_FAILED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'STORE_CLOSED'
  | 'NOT_SERVICEABLE'
  | 'BELOW_MIN_ORDER'
  | 'PRODUCT_UNAVAILABLE'
  | 'CUSTOMER_BLOCKED'
  | 'INSUFFICIENT_STOCK'
  | 'SETUP_INCOMPLETE'
  | 'INTERNAL_ERROR';

export interface StorefrontPage {
  page: number;
  pageSize: number;
  total: number;
}

// ------------------------------------------------------------------ store

export interface StorefrontAddress {
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  district?: string | null;
  stateCode: StateCode;
  pincode: string;
}

/** GET /store: everything the header, footer and checkout need. Nulls = not set yet in the admin. */
export interface StorefrontStore {
  /** false until the store has been set up in the admin. */
  configured: boolean;
  name: string;
  logoUrl: string | null;
  phones: string[];
  whatsappNumber: string | null;
  email: string | null;
  address: StorefrontAddress | null;
  gstin: string | null;
  licenseNumber: string | null;
  isOpen: boolean;
  closedMessage: string | null;
  orderMode: 'enquiry' | 'checkout';
  acceptedPaymentMethods: ('upi' | 'bank_transfer' | 'cash')[];
  announcement: { text: string | null; linkUrl: string | null } | null;
  /** Store-wide minimum; zones, states and cities can override (see /delivery). 0 = none. */
  minOrderValue: Paise | null;
  safetyPageSlug: string | null;
  payment: {
    upiId: string | null;
    upiPayeeName: string | null;
    upiQrImageUrl: string | null;
    bank: {
      accountName?: string | null;
      accountNumber?: string | null;
      ifsc?: string | null;
      bankName?: string | null;
      branch?: string | null;
    } | null;
    instructions: string | null;
  } | null;
}

// ------------------------------------------------------------------ catalogue

export interface StorefrontImage {
  /** Absolute URL. Cloudinary images accept width/height transforms (see PUBLIC_API.md). */
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

/** GET /categories: active categories, parents with their sub-categories. */
export interface StorefrontCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: StorefrontImage | null;
  /** Active products in this category (and its sub-categories). */
  productCount: number;
  children: StorefrontCategory[];
}

export type StorefrontSoundLevel = 'none' | 'low' | 'medium' | 'high' | 'very_high';

/** A product in lists (GET /products, GET /gift-boxes). */
export interface StorefrontProductCard {
  id: string;
  slug: string;
  sku: string;
  name: string;
  type: 'single' | 'combo';
  category: { slug: string; name: string } | null;
  subCategory: { slug: string; name: string } | null;
  /** Printed price. */
  mrp: Paise;
  /** Discount off MRP, e.g. 82.5. */
  discountPct: number;
  /** Selling price (GST included). This is the price the order uses. */
  netPrice: Paise;
  unit: 'box' | 'pkt' | 'piece';
  /** Pieces per unit, e.g. 10 sparklers per box. */
  contentsCount: number;
  isGreen: boolean;
  soundLevel: StorefrontSoundLevel;
  minAge: number | null;
  isFeatured: boolean;
  /** Stock is held only when the store confirms; this is a hint, not a promise. */
  inStock: boolean;
  image: StorefrontImage | null;
  tags: string[];
}

/** GET /products/:slug */
export interface StorefrontProduct extends StorefrontProductCard {
  description: string | null;
  images: StorefrontImage[];
  videoUrl: string | null;
  safetyWarning: string | null;
  /** Gift boxes: what is inside. */
  contents: { name: string; qty: number }[];
}

export interface StorefrontProductQuery {
  /** Category or sub-category slug (a parent includes its sub-categories). */
  category?: string;
  /** Name, SKU or tag. */
  q?: string;
  type?: 'single' | 'combo';
  green?: boolean;
  featured?: boolean;
  inStock?: boolean;
  sort?: 'featured' | 'price_asc' | 'price_desc' | 'discount' | 'name' | 'newest';
  page?: number;
  /** Max 60. */
  pageSize?: number;
}

// ------------------------------------------------------------------ delivery

export interface StorefrontDeliveryRule {
  /** Order subtotal band [from, below). */
  minOrderValue: Paise;
  maxOrderValue: Paise | null;
  type: 'flat' | 'percent' | 'free';
  /** Paise for flat, percent for percent. */
  value: number;
}

/** GET /delivery: where the store delivers and on what terms. */
export interface StorefrontDelivery {
  defaultMinOrderValue: Paise;
  states: {
    code: StateCode;
    name: string;
    isServiceable: boolean;
    /** Minimum that applies (state override, else zone, else store default). */
    minOrderValue: Paise;
    /** Shown when not serviceable (may be null). */
    note: string | null;
    zone: {
      name: string;
      /** to_pay: customer pays the transport on collection; prepaid: added to the bill by rules. */
      deliveryChargeMode: 'to_pay' | 'prepaid';
      deliveryRules: StorefrontDeliveryRule[];
      estimatedDays: { min: number; max: number } | null;
    } | null;
  }[];
  /** City exceptions (blocked cities, different minimums). Matching ignores case and spaces. */
  cities: {
    stateCode: StateCode;
    name: string;
    isServiceable: boolean;
    minOrderValue: Paise | null;
    note: string | null;
  }[];
}

/** GET /serviceability?stateCode=&city= */
export interface StorefrontServiceability {
  serviceable: boolean;
  reason: string | null;
  minOrderValue: Paise;
  zoneName: string | null;
  deliveryChargeMode: 'to_pay' | 'prepaid';
  estimatedDays: { min: number; max: number } | null;
}

// ------------------------------------------------------------------ cart, orders, tracking

export interface StorefrontCartLine {
  productId: string;
  /** 1–10,000; each product once per order. */
  qty: number;
}

/** POST /orders/preview body. */
export interface StorefrontCartPreviewInput {
  stateCode: StateCode;
  city?: string;
  items: StorefrontCartLine[];
}

export interface StorefrontPricing {
  mrpTotal: Paise;
  productDiscount: Paise;
  subtotal: Paise;
  couponCode: string | null;
  couponDiscount: Paise;
  deliveryCharge: Paise;
  deliveryChargeMode: 'to_pay' | 'prepaid';
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
  placeOfSupply: StateCode;
}

export interface StorefrontCartPreview {
  items: {
    productId: string;
    sku: string;
    name: string;
    unit: string;
    mrp: Paise;
    discountPct: number;
    netPrice: Paise;
    qty: number;
    lineTotal: Paise;
  }[];
  pricing: StorefrontPricing;
  serviceability: StorefrontServiceability;
  meetsMinimum: boolean;
  /** Lines that can't be ordered (removed or not for sale); they are not in `items`. */
  unavailable: { productId: string; reason: string }[];
}

/** POST /orders body (send the captcha token in the X-Captcha-Token header). */
export interface StorefrontOrderInput {
  customer: { name: string; phone: string; altPhone?: string; email?: string; gstin?: string };
  address: {
    line1: string;
    line2?: string;
    landmark?: string;
    city: string;
    district?: string;
    stateCode: StateCode;
    pincode: string;
  };
  items: StorefrontCartLine[];
  notes?: string;
}

export interface StorefrontOrderResult {
  orderNo: string;
  status: string;
  grandTotal: Paise;
  /** The store's own confirmation text (null if it hasn't set one). */
  message: string | null;
  /** Checkout mode only: pay by UPI now. */
  payment: { upiId: string | null; upiUri: string | null } | null;
}

/** GET /orders/track?orderNo=&phone= */
export interface StorefrontOrderTracking {
  orderNo: string;
  status: 'enquiry' | 'confirmed' | 'payment_received' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  paymentStatus: 'unpaid' | 'partial' | 'paid' | 'refunded';
  grandTotal: Paise;
  amountPaid: Paise;
  createdAt: string;
  dispatch: {
    transportName: string | null;
    lrNumber: string;
    dispatchDate: string | null;
    trackingUrl: string | null;
  } | null;
}

// ------------------------------------------------------------------ client

export class StorefrontApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'StorefrontApiError';
  }
}

export interface StorefrontClientOptions {
  /** e.g. https://api.example.com (no trailing slash, without /api/v1/public). */
  baseUrl: string;
  fetch?: typeof fetch;
}

/**
 * Typed client. Every method resolves to the response `data`, or throws
 * StorefrontApiError with the API's error code (switch on `code`, show `message`).
 */
export function createStorefrontClient(opts: StorefrontClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  const root = `${opts.baseUrl.replace(/\/$/, '')}/api/v1/public`;
  const qs = (q: Record<string, string | number | boolean | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  async function call<T, M = undefined>(path: string, init?: RequestInit): Promise<{ data: T; meta?: M }> {
    const res = await doFetch(`${root}${path}`, init);
    const body = (await res.json().catch(() => null)) as StorefrontSuccess<T, M> | StorefrontFailure | null;
    if (!res.ok || !body || body.success === false) {
      const err = body && body.success === false ? body.error : null;
      throw new StorefrontApiError(
        res.status,
        err?.code ?? 'INTERNAL_ERROR',
        err?.message ?? `Request failed (${res.status})`,
        err?.details,
      );
    }
    return { data: body.data, meta: body.meta };
  }
  const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  return {
    store: async () => (await call<StorefrontStore>('/store')).data,
    categories: async () => (await call<StorefrontCategory[]>('/categories')).data,
    products: (q: StorefrontProductQuery = {}) =>
      call<StorefrontProductCard[], StorefrontPage>(`/products${qs({ ...q })}`),
    product: async (slug: string) =>
      (await call<StorefrontProduct>(`/products/${encodeURIComponent(slug)}`)).data,
    giftBoxes: (q: Omit<StorefrontProductQuery, 'type'> = {}) =>
      call<StorefrontProductCard[], StorefrontPage>(`/gift-boxes${qs({ ...q })}`),
    delivery: async () => (await call<StorefrontDelivery>('/delivery')).data,
    serviceability: async (stateCode: StateCode, city?: string) =>
      (await call<StorefrontServiceability>(`/serviceability${qs({ stateCode, city })}`)).data,
    /** Link for a download button (PDF). */
    priceListUrl: (q: { category?: string } = {}) => `${root}/price-list.pdf${qs(q)}`,
    previewCart: async (input: StorefrontCartPreviewInput) =>
      (await call<StorefrontCartPreview>('/orders/preview', json(input))).data,
    submitOrder: async (input: StorefrontOrderInput, captchaToken?: string) =>
      (
        await call<StorefrontOrderResult>(
          '/orders',
          json(input, captchaToken ? { 'X-Captcha-Token': captchaToken } : {}),
        )
      ).data,
    trackOrder: async (orderNo: string, phone: string) =>
      (await call<StorefrontOrderTracking>(`/orders/track${qs({ orderNo, phone })}`)).data,
  };
}

export type StorefrontClient = ReturnType<typeof createStorefrontClient>;
