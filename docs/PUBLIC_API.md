# Storefront API guide

For the developer of the customer website (`sakthimaan-crackers` repo). Everything the website needs comes from the admin API under `/api/v1/public`: store details, catalogue, delivery terms, the price list, enquiry submission and order tracking. Nothing on the website should be hard-coded (store name, prices, minimum order, where you deliver): the shop staff change these in the admin, and the website must reflect them.

- **Base URL:** `https://api.<domain>/api/v1/public` (development: `http://localhost:4000/api/v1/public`).
- **Types and client:** [`docs/storefront-client.ts`](./storefront-client.ts) is a single self-contained file with every request/response type and a typed `fetch` client. Copy it into the website repo as-is. Regenerate it after API changes with `npm run storefront:export -w @sakthimaan/api`.
- **OpenAPI:** [`docs/public-api.openapi.json`](./public-api.openapi.json) (same command). In development the full interactive docs are at `http://localhost:4000/api/docs`.

```ts
import { createStorefrontClient, StorefrontApiError } from './storefront-client';

const api = createStorefrontClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL! }); // https://api.<domain>

const store = await api.store();
const { data: products, meta } = await api.products({ category: 'sparklers', sort: 'price_asc' });
```

## Contents

1. [Conventions](#1-conventions)
2. [Endpoints](#2-endpoints)
3. [Showing prices, images, minimum order and delivery](#3-showing-prices-images-minimum-order-and-delivery)
4. [Enquiry / order submission](#4-enquiry--order-submission)
5. [Order tracking](#5-order-tracking)
6. [Errors](#6-errors)
7. [Rate limits, CORS and captcha](#7-rate-limits-cors-and-captcha)

## 1. Conventions

| Topic      | Rule                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope   | Success: `{ "success": true, "data": …, "meta"?: … }`. Failure: `{ "success": false, "error": { "code", "message", "details"? } }`.                       |
| Money      | **Integer paise** everywhere (`19900` = ₹199.00). Format with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` after dividing by 100. |
| Prices     | GST is **included** in every price. Never compute prices on the website for the bill: use `/orders/preview`.                                              |
| Dates      | ISO 8601 strings in UTC; show them in IST (`timeZone: 'Asia/Kolkata'`).                                                                                   |
| States     | ISO 3166-2:IN codes (`TN`, `KA`, `DL`…). The full list with names is in `GET /delivery`.                                                                  |
| Phone      | 10-digit Indian mobile. `+91 98765 43210`, `098765 43210` and `9876543210` are all accepted.                                                              |
| Pagination | `?page=1&pageSize=24` (max 60). `meta: { page, pageSize, total }`.                                                                                        |
| Auth       | None. These endpoints are public; the website never sees admin tokens.                                                                                    |

## 2. Endpoints

| Method | Path              | What                                                     | Client method                     |
| ------ | ----------------- | -------------------------------------------------------- | --------------------------------- |
| GET    | `/store`          | Store name, logo, contact, licence, open/closed, mode    | `api.store()`                     |
| GET    | `/categories`     | Active categories with sub-categories and product counts | `api.categories()`                |
| GET    | `/products`       | Product list (filters, sort, pagination)                 | `api.products(q)`                 |
| GET    | `/products/:slug` | One product (all images, description, safety, contents)  | `api.product(slug)`               |
| GET    | `/gift-boxes`     | Gift boxes (same filters as `/products`)                 | `api.giftBoxes(q)`                |
| GET    | `/delivery`       | Serviceable states, zones, charges, minimums, cities     | `api.delivery()`                  |
| GET    | `/serviceability` | Check one state/city                                     | `api.serviceability(state, city)` |
| GET    | `/price-list.pdf` | Printable price list (PDF)                               | `api.priceListUrl(q)`             |
| POST   | `/orders/preview` | Bill for a cart: totals, GST, minimum, serviceability    | `api.previewCart(input)`          |
| POST   | `/orders`         | Submit an enquiry / order                                | `api.submitOrder(input, token)`   |
| GET    | `/orders/track`   | Order status for the customer                            | `api.trackOrder(orderNo, phone)`  |

### GET /store

```json
{
  "success": true,
  "data": {
    "configured": true,
    "name": "Sakthimaan Crackers",
    "logoUrl": "https://res.cloudinary.com/…/company/logo.webp",
    "phones": ["9443011223", "9443044556"],
    "whatsappNumber": "9443011223",
    "email": "orders@example.com",
    "address": {
      "line1": "12, Sattur Main Road",
      "city": "Sivakasi",
      "district": "Virudhunagar",
      "stateCode": "TN",
      "pincode": "626123"
    },
    "gstin": "33ABCDE1234F1Z5",
    "licenseNumber": "LE/SVK/2026/0457",
    "isOpen": true,
    "closedMessage": null,
    "orderMode": "enquiry",
    "acceptedPaymentMethods": ["upi", "bank_transfer", "cash"],
    "announcement": { "text": "Diwali 2026 orders open: up to 85% off!", "linkUrl": null },
    "minOrderValue": 300000,
    "safetyPageSlug": "safety-instructions",
    "payment": {
      "upiId": "shop@bank",
      "upiPayeeName": "…",
      "upiQrImageUrl": null,
      "bank": { "accountName": "…", "accountNumber": "…", "ifsc": "…", "bankName": "…" },
      "instructions": "…"
    }
  }
}
```

- Use `name`, `logoUrl`, `phones`, `whatsappNumber`, `address`, `gstin` and `licenseNumber` in the header and footer. Any of them can be empty or `null` until the shop fills them in: hide the element rather than showing a placeholder.
- `isOpen: false`: show `closedMessage` and disable the enquiry form (the API refuses orders with `STORE_CLOSED` anyway).
- `announcement`: show a top bar when not `null`.
- `orderMode`: `enquiry` (default; the shop calls to confirm) or `checkout` (confirmed at once; show the UPI payment step).
- `payment` is `null` unless the shop chose to show payment details on the website.
- Cache for a minute or two; it changes rarely.

### GET /categories

```json
{
  "success": true,
  "data": [
    {
      "id": "6acd…",
      "slug": "sparklers",
      "name": "Sparklers",
      "description": null,
      "image": { "url": "https://…/sparklers.webp", "alt": "Sparklers", "width": 1200, "height": 900 },
      "productCount": 8,
      "children": [
        {
          "id": "6acd…",
          "slug": "sparklers-7cm",
          "name": "7cm",
          "description": null,
          "image": null,
          "productCount": 2,
          "children": []
        }
      ]
    }
  ]
}
```

Only active categories (and active parents) are returned, in the shop's order. `productCount` counts active products; a parent's count includes its sub-categories. Hide categories with `productCount: 0` if you prefer.

### GET /products and GET /gift-boxes

Query parameters (all optional):

| Param              | Values                                                                        | Notes                                                      |
| ------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `category`         | category or sub-category slug                                                 | A parent slug includes its sub-categories.                 |
| `q`                | text                                                                          | Matches name, SKU and tags.                                |
| `type`             | `single`, `combo`                                                             | `/gift-boxes` is `/products?type=combo`.                   |
| `green`            | `true` / `false`                                                              | Green crackers only.                                       |
| `featured`         | `true` / `false`                                                              | For a "featured" strip on the home page.                   |
| `inStock`          | `true`                                                                        | Only products in stock.                                    |
| `sort`             | `featured` (default), `price_asc`, `price_desc`, `discount`, `name`, `newest` | `featured` = shop's featured items first, then shop order. |
| `page`, `pageSize` | 1…, 1–60 (default 24)                                                         |                                                            |

```json
{
  "success": true,
  "data": [
    {
      "id": "6acd…",
      "slug": "7cm-electric-sparkler",
      "sku": "SP-7-ELEC",
      "name": "7cm Electric Sparkler",
      "type": "single",
      "category": { "slug": "sparklers", "name": "Sparklers" },
      "subCategory": { "slug": "sparklers-7cm", "name": "7cm" },
      "mrp": 19900,
      "discountPct": 82.5,
      "netPrice": 3500,
      "unit": "box",
      "contentsCount": 10,
      "isGreen": true,
      "soundLevel": "none",
      "minAge": 6,
      "isFeatured": true,
      "inStock": true,
      "image": { "url": "https://…/sp7.webp", "alt": "7cm Electric Sparkler", "width": 1200, "height": 1200 },
      "tags": ["kids", "sparkler"]
    }
  ],
  "meta": { "page": 1, "pageSize": 24, "total": 51 }
}
```

### GET /products/:slug

The card fields plus `description`, all `images`, `videoUrl`, `safetyWarning` and, for gift boxes, `contents`:

```json
{ "success": true, "data": { "…card fields…": "…", "description": "…", "images": [ … ], "videoUrl": null, "safetyWarning": "Hold at arm's length. Adult supervision.", "contents": [{ "name": "7cm Electric Sparkler", "qty": 2 }] } }
```

A product that is a draft, deleted or in a hidden category returns `404 NOT_FOUND`: show your normal not-found page.

### GET /delivery

```json
{
  "success": true,
  "data": {
    "defaultMinOrderValue": 300000,
    "states": [
      {
        "code": "TN",
        "name": "Tamil Nadu",
        "isServiceable": true,
        "minOrderValue": 200000,
        "note": null,
        "zone": {
          "name": "Tamil Nadu",
          "deliveryChargeMode": "to_pay",
          "deliveryRules": [],
          "estimatedDays": { "min": 2, "max": 4 }
        }
      },
      {
        "code": "DL",
        "name": "Delhi",
        "isServiceable": false,
        "minOrderValue": 300000,
        "note": "Firecrackers are banned in Delhi.",
        "zone": null
      }
    ],
    "cities": [
      { "stateCode": "TN", "name": "Chennai", "isServiceable": true, "minOrderValue": 250000, "note": null }
    ]
  }
}
```

All 36 states/UTs are listed. Use it for the state drop-down (mark or hide non-serviceable ones) and a "Where we deliver" page. `cities` lists exceptions only (blocked cities or different minimums); other cities follow their state.

### GET /serviceability?stateCode=TN&city=Chennai

```json
{
  "success": true,
  "data": {
    "serviceable": true,
    "reason": null,
    "minOrderValue": 200000,
    "zoneName": "Tamil Nadu",
    "deliveryChargeMode": "to_pay",
    "estimatedDays": { "min": 2, "max": 4 }
  }
}
```

Call it when the customer picks a state/city (before the cart) to show the minimum and delivery time, or `reason` if you don't deliver there. City matching ignores case and extra spaces.

### GET /price-list.pdf?category=sparklers

The same printable price list the shop uses (logo, prices, a Qty column to fill in). Without `category` it covers everything. Link to it directly (`api.priceListUrl()`); it opens inline in the browser. It has a stricter rate limit (see §7).

## 3. Showing prices, images, minimum order and delivery

**Prices**

- Show `netPrice` as the price, `mrp` struck through, and `discountPct` as "82.5% off". All include GST: say "Prices include GST".
- Don't calculate totals for the bill yourself (rounding, GST split, delivery charges and the minimum all come from the server). For a live cart total, call `POST /orders/preview` (debounce it, e.g. 400 ms after the last change).
- `contentsCount` + `unit`: "10 pcs / box".
- `inStock` is a hint. In enquiry mode stock is held only when the shop confirms, so you may still let customers add out-of-stock items with an "On request" label; the shop will call them.

**Images**

- URLs are absolute. On Cloudinary (production) you can ask for a resized, auto-format version by inserting a transform after `/upload/`, e.g. `…/upload/f_auto,q_auto,c_limit,w_600/…`. Use `w_300` for cards and `w_1200` for the detail gallery. Other URLs (development) are served as-is.
- `image` is `null` when the shop hasn't added a photo: show a neutral placeholder.
- Use `alt` for the `alt` attribute (fall back to the product name).

**Minimum order and delivery**

- The minimum depends on where the order goes (city → state → zone → store default). Show the store default (`/store.minOrderValue`) on the home page, the exact one once the customer picks a state (`/serviceability` or `/delivery`), and the cart's `meetsMinimum` from `/orders/preview` before they submit. `0` means no minimum.
- `deliveryChargeMode: "to_pay"`: the customer pays the transport when collecting the parcel (show "Delivery charges payable at the transport office"). `"prepaid"`: the charge is added to the bill by the zone's `deliveryRules`; `/orders/preview` already includes it.
- Not serviceable: show `reason` / `note`, and don't let them submit (the API refuses with `NOT_SERVICEABLE`).

## 4. Enquiry / order submission

**Preview the cart:**

```http
POST /api/v1/public/orders/preview
Content-Type: application/json

{ "stateCode": "TN", "city": "Chennai", "items": [{ "productId": "6acd…", "qty": 2 }] }
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "productId": "6acd…",
        "sku": "SP-7-ELEC",
        "name": "7cm Electric Sparkler",
        "unit": "box",
        "mrp": 19900,
        "discountPct": 82.5,
        "netPrice": 3500,
        "qty": 2,
        "lineTotal": 7000
      }
    ],
    "pricing": {
      "mrpTotal": 39800,
      "productDiscount": 32800,
      "subtotal": 7000,
      "deliveryCharge": 0,
      "deliveryChargeMode": "to_pay",
      "packingCharge": 0,
      "taxableValue": 5932,
      "cgst": 534,
      "sgst": 534,
      "igst": 0,
      "totalTax": 1068,
      "roundOff": 0,
      "grandTotal": 7000,
      "isInterState": false,
      "placeOfSupply": "TN",
      "…": "…"
    },
    "serviceability": { "serviceable": true, "minOrderValue": 200000, "…": "…" },
    "meetsMinimum": false,
    "unavailable": []
  }
}
```

Show `pricing.grandTotal` as the total, the discount saved (`productDiscount`), and a message when `meetsMinimum` is false ("Add ₹1,930 more to reach the ₹2,000 minimum for Tamil Nadu"). `unavailable` lists products that can no longer be ordered (they are left out of `items`): ask the customer to remove them.

**Submit:**

```http
POST /api/v1/public/orders
Content-Type: application/json
X-Captcha-Token: <token, once a captcha is enabled>

{
  "customer": { "name": "Ravi Kumar", "phone": "9876543210", "email": "ravi@example.com" },
  "address": { "line1": "12 Gandhi Road", "landmark": "Near bus stand", "city": "Chennai", "stateCode": "TN", "pincode": "600001" },
  "items": [{ "productId": "6acd…", "qty": 60 }],
  "notes": "Please call after 6 pm"
}
```

```json
{
  "success": true,
  "data": {
    "orderNo": "ORD/26-27/000022",
    "status": "enquiry",
    "grandTotal": 210000,
    "message": "Thank you! We have received your enquiry. Our team will call you to confirm the list and the total.",
    "payment": null
  }
}
```

- Show `orderNo` prominently (the customer needs it to track the order) and the shop's `message` (it can be `null`: then show your own neutral thank-you).
- Prices sent by the website are ignored; the server prices every line from the catalogue.
- `payment` is set only in **checkout** mode: `{ upiId, upiUri }`. On phones, `upiUri` (`upi://pay?...`) opens the customer's UPI app with the amount filled in; on desktop, render it as a QR code.
- Validation rules: name 2–120 chars; phone a 10-digit Indian mobile; PIN code 6 digits; 1–200 lines, each product once, quantity 1–10,000; optional GSTIN for business buyers.
- Disable the submit button while the request runs (the endpoint is rate-limited per IP).

## 5. Order tracking

```http
GET /api/v1/public/orders/track?orderNo=ORD/26-27/000022&phone=9876543210
```

```json
{
  "success": true,
  "data": {
    "orderNo": "ORD/26-27/000022",
    "status": "dispatched",
    "paymentStatus": "paid",
    "grandTotal": 210000,
    "amountPaid": 210000,
    "createdAt": "2026-10-13T06:40:00.000Z",
    "dispatch": {
      "transportName": "KPN Parcel Service",
      "lrNumber": "LR-778899",
      "dispatchDate": "2026-10-15T00:00:00.000Z",
      "trackingUrl": "https://…?lr=LR-778899"
    }
  }
}
```

Both the order number and the phone used on the order are required (so people can't look up others' orders). A wrong pair returns `404 NOT_FOUND`: say "We couldn't find an order with that number and phone".

| `status`           | Show the customer                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `enquiry`          | Received – we'll call you to confirm                                                      |
| `confirmed`        | Confirmed – awaiting payment                                                              |
| `payment_received` | Paid – being packed                                                                       |
| `packed`           | Packed – ready for dispatch                                                               |
| `dispatched`       | Dispatched – collect from the transport office (show transport, LR number, tracking link) |
| `delivered`        | Delivered                                                                                 |
| `cancelled`        | Cancelled                                                                                 |

## 6. Errors

Always show `error.message` (it is written for customers) and branch on `error.code` when you need to:

| HTTP | `code`                | When / what to do                                                                                      |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`    | `details: [{ location, path, message }]`, e.g. `path: "address.pincode"`. Show next to the field.      |
| 400  | `NOT_SERVICEABLE`     | We don't deliver to that state/city.                                                                   |
| 400  | `BELOW_MIN_ORDER`     | `details: { minOrderValue, subtotal }`. Ask them to add more.                                          |
| 400  | `PRODUCT_UNAVAILABLE` | `details.items: [{ productId, reason }]`. Remove those lines.                                          |
| 400  | `CAPTCHA_FAILED`      | Re-run the captcha and retry.                                                                          |
| 403  | `CUSTOMER_BLOCKED`    | Show the message; suggest calling the shop.                                                            |
| 404  | `NOT_FOUND`           | Product, category or order not found.                                                                  |
| 409  | `STORE_CLOSED`        | Show the message (the shop's closed message).                                                          |
| 409  | `SETUP_INCOMPLETE`    | The shop hasn't finished its setup (e.g. GST details). Show "Orders are not open yet; please call us". |
| 429  | `RATE_LIMITED`        | Too many requests. `Retry-After` header says when to retry.                                            |
| 500  | `INTERNAL_ERROR`      | Something went wrong. `X-Request-Id` header identifies it for the shop's support.                      |

With the client: `catch (e) { if (e instanceof StorefrontApiError && e.code === 'BELOW_MIN_ORDER') … }`.

## 7. Rate limits, CORS and captcha

**Rate limits** (per IP; configurable on the API with the env vars shown):

| Endpoints                             | Limit (default)   | Env var                             |
| ------------------------------------- | ----------------- | ----------------------------------- |
| All public reads                      | 120 per minute    | `RATE_LIMIT_PUBLIC_READ_PER_MIN`    |
| `POST /orders`, `GET /price-list.pdf` | 10 per 10 minutes | `RATE_LIMIT_PUBLIC_WRITE_PER_10MIN` |

Responses include standard `RateLimit` / `RateLimit-Policy` headers; a `429` includes `Retry-After`. If the website renders on a server (SSR), all its requests come from one IP: cache catalogue responses (e.g. revalidate every 60 s) rather than calling the API on every page view.

**CORS:** the API only answers browsers from the origins listed in its `CORS_PUBLIC_ORIGINS` env var (comma-separated full origins, e.g. `https://www.example.com,https://example.com`). Give the shop your production and preview origins to add. Allowed: `GET`, `POST`; headers `Content-Type`, `X-Captcha-Token`, `X-Request-Id`. No cookies are used (`credentials: false`), so don't send `credentials: 'include'`.

**Captcha:** `POST /orders` checks the `X-Captcha-Token` header through a pluggable verifier. Today the provider is `none` (accepts everything; rate limits still apply). When the shop enables one (e.g. Cloudflare Turnstile or hCaptcha, both free), you will add their widget to the enquiry form and send its token in that header; nothing else changes. `api.submitOrder(input, token)` already sends it.
