# Sakthimaan Crackers Admin: Architecture

Phase 1 baseline, revised after review. The data models, pricing/GST engine, numbering and RBAC matrix are real, tested code:

- Shared domain logic: [packages/shared/src](../packages/shared/src). This holds enums, RBAC, order workflow, money/rounding, the GST pricing engine, document numbering, and WhatsApp/UPI links.
- Mongoose schemas and indexes: [apps/api/src/models](../apps/api/src/models)
- Tests: `packages/shared/src/*.test.ts` (unit) and `apps/api/tests/models.test.ts`. The model tests run on an in-memory MongoDB replica set.

The API serves **two clients**:

1. The admin panel in this repo, under `/api/v1/...` (JWT auth).
2. The customer website in the separate `sakthimaan-crackers` repo, under `/api/v1/public/...` (no auth, separate CORS, rate limits and captcha hook).

---

## 1. Key design decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Money is integer paise.** Percentages are converted to integer **basis points** before any arithmetic. | Exact totals. Immune to float artefacts such as `100 − 82.3 = 17.700000000000003`. |
| 2 | **`computeNetPrice(mrp, discount%, rounding)`** in `shared` is the only net-price formula. Rounding is configurable: `nearest_rupee` (default) or `nearest_paisa`, with halves rounding up. | The UI preview equals what the API stores. ₹199 at 82.5% → ₹34.825 → **₹35.00** (rupee) or **₹34.83** (paisa). The rounding mode lives in `settings.pricing`. Changing it recomputes every product's `netPrice` (with a preview count first). |
| 3 | **Prices are GST-inclusive. Taxable value is back-calculated per line**, after allocating any coupon discount across lines (largest-remainder method, exact to the paisa). | Matches how Sivakasi price lists are printed. The invariant `taxable + tax = gross` holds on every line and total (tested). |
| 4 | **GST comes from data, never hardcoded.** `hsn`/`taxRate` live on the product (null = inherit), then the category, then settings (default **3604 / 18%**, configurable for the accountant). Seller state is **TN (GST code 33)**: intra-state buyers get **CGST + SGST**, inter-state buyers get **IGST**. | The rate can change without a deploy. `resolveTax()` gives the effective value, which is snapshotted on order lines. |
| 5 | **Delivery/packing charges are a composite supply.** They take the principal goods' HSN and rate and appear in the same HSN-summary row. | The standard GST treatment when the seller bills transport with the goods. With `to_pay` delivery the charge is 0 and is paid to the transporter. |
| 6 | **Round-off line.** Grand total = gross rounded to the nearest rupee, and `roundOff` (−₹0.49…+₹0.50) is stored and printed. | Common invoice practice. The breakdown stays reconcilable. |
| 7 | **Order lines are complete snapshots.** Each line stores name, SKU, category, HSN, MRP, discount %, net price, tax rate, unit, quantity, and the per-line taxable/CGST/SGST/IGST. Nothing is re-read from the product. | Editing or deleting a product, or reusing its SKU, can never change an existing order or invoice. A test covers exactly this. |
| 8 | **Invoices and credit notes are separate, immutable collections.** Each is a full snapshot of seller (GSTIN, licence), buyer, lines, HSN summary and totals. | Reprints years later stay identical even after the company profile changes. Query updates and deletes are blocked by an `immutablePlugin`. The only permitted change is an invoice becoming `cancelled` by a credit note. |
| 9 | **GST-compliant numbering.** At most 16 characters, letters/digits/`-`/`/` only, consecutive per financial year (April–March, evaluated in IST). Invoice `SMC/26-27/00042` (15 chars). Credit note `SMC/CN/26-27/001` (16 chars). | Numbers come from a `Counter` (`invoice:26-27`) incremented **inside the issuing transaction**. An aborted transaction consumes no number (tested), so there are no gaps. Unique indexes on `number` and `(financialYear, seq)` mean a number can never be reused. Formats are validated so the longest possible number still fits in 16 characters. |
| 10 | **Cancelling after invoicing issues a credit note.** It is created in the same transaction as the cancellation, mirrors the invoice lines, and marks the invoice `cancelled`. The invoice is never edited or deleted. | Required by GST. Orders that have an invoice cannot be soft-deleted. |
| 11 | **Stock is deducted at _Confirm_.** This uses a transaction with a conditional atomic `$inc` (`stock ≥ qty`) per line plus a ledger row. Enquiries hold no stock. Their **pending demand** is shown per product on the inventory screen. | On a shortage, Confirm fails with `409 INSUFFICIENT_STOCK` and `details.items[] = {productId, sku, name, requested, available, shortBy}`, so staff can edit or substitute lines. `stockCommitted` makes both deduction and restock idempotent. |
| 12 | **Two concurrency mechanisms.** (a) Order-driven deductions use atomic conditional updates. (b) Manual absolute stock edits, order edits and settings use optimistic concurrency (`stockVersion`, Mongoose `optimisticConcurrency`). A stale write returns `409 CONFLICT`. | (a) has no lost updates under Diwali-peak contention. (b) stops two staff overwriting each other during phone edits. |
| 13 | **Gift boxes are Products with `type: 'combo'` and `stockMode: 'own'`**: factory pre-packed, with their own stock. `components` is reserved and rejected by validation for now. | Price list, orders, invoices and reports need no special cases. |
| 14 | **Packing before payment is a guarded transition.** `confirmed → packed` requires `orders:pack` **and** `orders:pack_unpaid`, **and** `customer.creditAllowed`. Every use is audited as `pack_unpaid` and flags the order `packedOnCredit`. | The default is strict. Credit is an explicit, per-customer, audited decision. Toggling `creditAllowed` needs `customers:credit` and is also audited. |
| 15 | **No payment gateway.** Payments are manual (UPI, bank transfer, cash) with a reference (UTR) and an optional screenshot. Customers may submit proof from the website (`submitted`), and staff verify it (`recorded`) or reject it. Records are never edited, only voided. `kind: refund` covers refunds. | Only `recorded` payments count toward `amountPaid`. A UPI QR is generated from `settings.payment.upiId` (or uploaded) and shown on the storefront and invoice. |
| 16 | **No WhatsApp/SMS provider.** Staff get generated **click-to-WhatsApp links** (`wa.me/91…?text=`), rendered from the notification templates. The provider-agnostic `NotificationProvider` interface stays for later. | Zero cost. Staff send from their own WhatsApp. |
| 17 | **Images on Cloudinary** behind a `StorageProvider` interface, with a local-disk driver for development. **No Redis**: the dashboard cache is in-memory behind a `CacheProvider` interface. | As approved. Either can be swapped later without touching services. |
| 18 | **Soft delete uses an `isDeleted` boolean** plus `deletedAt`/`deletedBy`, enforced by a query plugin. Unique indexes are partial on `isDeleted: false`. | A deleted SKU, phone number or email can be reused. Aggregations must start with `activeMatch`. |
| 19 | **Order timeline, payments and audit log are separate collections.** The audit log is written explicitly by services. | Comments don't bump the order version. Each audit entry has the actor, request ID and a field-level diff. |
| 20 | **Roles fixed in code with granular `resource:action` permissions.** | One source of truth for API middleware and UI gating. Order transitions declare their permissions in `transitionRequirements()`. |
| 21 | **Refresh tokens are opaque, hashed, rotated, with family reuse detection.** The access JWT lives about 15 minutes and carries `tokenVersion`. | Reusing a rotated token revokes the whole family. Bumping `tokenVersion` ends every session for that user. |
| 22 | **Serviceability resolves as City override → State → Zone → store default.** | Cities only store exceptions, such as a city where crackers are banned. |
| 23 | **MongoDB is always a replica set.** That means mongodb-memory-server in tests, a single-node `rs0` in docker-compose, and Atlas in production. | Transactions behave the same everywhere. |
| 24 | **PDFs use `pdfmake`** (pure JS), rendered from the invoice and credit-note snapshots. | Runs on small Render/Railway/VPS instances without Chromium. |
| 25 | **ESM + strict TypeScript 5.9, npm workspaces, Vitest.** `shared` exposes a `source` export condition, so tests and dev run against TS sources without a build. | TS 7 is newer than parts of the lint/Vite chain, so the upgrade is left for later. |

---

## 2. System overview

```
  Staff (phone/PC)                                   Customers
        │                                                │
 ┌──────▼─────────── apps/admin ───────┐   ┌────── sakthimaan-crackers (separate repo) ──┐
 │ React · TanStack Query · RHF + Zod  │   │ storefront: catalogue, enquiry, pay via UPI │
 └──────┬──────────────────────────────┘   └──────┬──────────────────────────────────────┘
        │ /api/v1/*   Bearer + httpOnly refresh   │ /api/v1/public/*   no auth, captcha hook
        │ CORS: ADMIN origins (credentials)       │ CORS: PUBLIC origins (no credentials)
 ┌──────▼─────────────────────── apps/api (Express 5) ───────▼───────────────────────────┐
 │ helmet · compression · requestId · pino · mongo-sanitize · per-namespace rate limits  │
 │ admin: authenticate → requirePermission → validate(zod)   public: captcha → validate  │
 │ routes → controllers → services (transactions, audit) → repositories → models         │
 │ providers: storage(Cloudinary/local) · notify(wa.me links) · cache(memory) · pdf · mail│
 └───────────────────────────────┬──────────────────────────────────────────────────────┘
                                 ▼
                     MongoDB replica set (Atlas / local rs0)
          packages/shared ── enums · RBAC · pricing/GST · numbering · zod schemas
```

---

## 3. Folder structure

```
sakthimaan-crackers-admin/
├─ package.json · tsconfig.base.json · docker-compose.yml (mongo rs0)
├─ docs/ARCHITECTURE.md
├─ packages/shared/src/
│  ├─ enums.ts · permissions.ts · order-workflow.ts · states.ts
│  ├─ money.ts            # paise, basis points, computeNetPrice (rounding), inclusive GST split
│  ├─ pricing.ts          # priceOrder(): coupon allocation, per-line GST, HSN summary, round-off
│  ├─ tax.ts              # resolveTax(), seller state, intra/inter-state
│  ├─ document-number.ts  # financial year, ≤16-char numbering, format validation
│  ├─ links.ts            # wa.me links, UPI URI, {{template}} rendering
│  └─ schemas/            # zod request schemas (auth from phase 2, more per module)
├─ apps/api/
│  ├─ src/
│  │  ├─ app.ts · server.ts      # app factory · bootstrap + graceful shutdown
│  │  ├─ config/                 # env (zod), db, logger, openapi
│  │  ├─ models/                 # mongoose schemas + plugins (soft-delete, immutable)
│  │  ├─ repositories/ services/ controllers/
│  │  ├─ routes/v1/              # admin routers · routes/v1/public/ storefront routers
│  │  ├─ middlewares/            # auth, rbac, validate, error, request-id, rate-limit, sanitize, captcha
│  │  ├─ providers/              # storage/, notifications/, mail/, captcha/, cache/, pdf/
│  │  ├─ jobs/                   # auto-cancel unpaid checkout orders
│  │  ├─ utils/                  # AppError, http envelope, pagination, crypto
│  │  └─ scripts/                # create-super-admin, seed (phase 8)
│  └─ tests/                     # vitest + supertest + mongodb-memory-server (replica set)
└─ apps/admin/src/
   ├─ app/ components/ui/ components/ lib/ stores/
   └─ features/<feature>/{api/, components/, pages/, schemas.ts}
```

---

## 4. Data model

26 collections. All amounts are in **paise**. ✱ = soft-deletable. 🔒 = immutable (no updates or deletes).

| Collection | Purpose / notable fields | Indexes |
|---|---|---|
| `users` ✱ | `email`, `passwordHash` (select:false), `role`, `failedLoginAttempts`, `lockUntil`, `tokenVersion`, `passwordReset`, `twoFactor` (hook) | email unique (partial), role+isActive, reset-token hash |
| `refreshtokens` | `user`, `familyId`, `tokenHash`, `tokenVersion`, `expiresAt`, `revokedAt`, `replacedByHash` | tokenHash unique, user+revokedAt, familyId, **TTL** |
| `categories` ✱ | two-level tree (`parent`), `image`, `sortOrder`, **`hsn`/`taxRate` overrides (null = inherit)** | slug unique (partial), parent+sortOrder, isActive+sortOrder |
| `products` ✱ | `sku`, `type` single/combo, **`stockMode` own (components reserved)**, `mrp`, `discountPct`, **`netPrice`** (derived with the configured rounding), **`hsn`/`taxRate` overrides**, `unit`, `contentsCount`, `stock`, `stockVersion`, `lowStockThreshold`, `images[]`, `videoUrl`, `isGreen`, `soundLevel`, `minAge`, `comboItems[]`, flags, `sortOrder` | sku/slug unique (partial), category+isActive+sortOrder, subCategory, featured, type, comboItems.product, updatedAt, text |
| `stockmovements` | append-only ledger: `type`, signed `qty`, `balanceBefore/After`, `reason`, `refType/refId/refLabel`, `actor` | product+createdAt, ref, type+createdAt, createdAt |
| `stockbatches` | optional lots | product+lotNumber unique, FIFO |
| `customers` ✱ | `phone` (identity), `gstin`, `addresses[]`, **`creditAllowed`**, `isBlocked`, `stats` | phone unique (partial), email, totalSpent, lastOrderAt, isBlocked, creditAllowed, text |
| `orders` ✱ | `orderNo`, `status`, `mode`, `source`, `customer` + snapshot, `shippingAddress`, **`items[]` full snapshots incl. per-line GST**, **`pricing`** (= `priceOrder()` output: mrpTotal, productDiscount, subtotal, coupon, delivery/packing + charges tax, taxable/CGST/SGST/IGST, totalTax, grossTotal, **roundOff**, grandTotal, isInterState, sellerStateCode, placeOfSupply, rounding mode), `paymentStatus`, `amountPaid`, `stockCommitted`, **`packedOnCredit`**, `dispatch{transport, LR no., date, boxes…}`, **`invoice{id, number, issuedAt}`**, **`creditNotes[]`** | orderNo unique; status+createdAt; **status+items.product (demand)**; paymentStatus; phone; customer; state; createdAt+_id (cursor); dispatchDate; LR no.; invoice.number; items.product |
| `invoices` 🔒 | `number` (≤16), `financialYear`, `seq`, `issuedAt`, `order/orderNo`, **seller snapshot (GSTIN, licence, state)**, buyer snapshot, `placeOfSupply`, `isInterState`, `items[]`, `hsnSummary[]`, `totals` (incl. roundOff, amount in words), `terms`, `status` issued/cancelled, `cancelledBy{creditNote, number, at}` | number unique, FY+seq unique, order unique, issuedAt, status+issuedAt |
| `creditnotes` 🔒 | same snapshot structure plus `invoice`, `invoiceNumber`, `invoiceDate`, `reasonCode`, `reason` | number unique, FY+seq unique, invoice, order, issuedAt |
| `orderactivities` | timeline: status changes, edits, payments, credit notes, `packed_on_credit`, comments | order+createdAt |
| `payments` | `kind` payment/refund, `amount`, `method` upi/bank/cash, `reference` (UTR), `paidAt`, `screenshot`, `source` staff/customer, `status` submitted/recorded/rejected/voided | order, status+createdAt (verification queue), paidAt+method, reference |
| `coupons` ✱ / `couponredemptions` | flat/percent, cap, min order, validity, limits, `autoApply` (early-bird) / one row per use | code unique (partial) … / coupon+order unique |
| `zones` · `states` · `cities` · `transportpartners` | shipping rules, serviceability, min order, transport list | as before |
| `banners` · `faqs` · `cmspages` · `notificationtemplates` · `seasons` | CMS, wa.me message templates, season dates | as before |
| `settings` | singleton: `company` (GSTIN, **licenseNumber**), `storefront` (isOpen, orderMode, announcement), **`tax` (sellerStateCode TN, defaultHsn, defaultTaxRate)**, **`pricing.netPriceRounding`**, **`invoice` (prefix, format, creditNoteFormat, showUpiQr)**, **`payment` (UPI ID/payee, QR image, bank details, instructions)**, `order`, `inventory`, `notifications` | (singleton) |
| `auditlogs` | actor, action (incl. `pack_unpaid`, `credit_change`, `issue`), entity (incl. `invoice`, `credit_note`), diff, requestId | entity+entityId, actor, action, createdAt+_id |
| `counters` | `invoice:26-27`, `credit_note:26-27`, `order:26-27` | `_id` |

### Critical flows (each runs in one transaction; notifications happen after commit)

```
CONFIRM (enquiry → confirmed)
  for each line: Product.updateOne({_id, stock ≥ qty}, {$inc: {stock: −qty, stockVersion: 1}})
                 0 matched → collect shortage
  any shortage → abort → 409 INSUFFICIENT_STOCK { items: [{sku, name, requested, available, shortBy}] }
  ledger rows (order_deduct) · status=confirmed · stockCommitted=true · coupon redemption · customer stats
  activity + audit

ISSUE INVOICE (confirmed or later, once per order)
  Counter $inc "invoice:<FY>" → number via settings.invoice.format (validated ≤ 16 chars)
  Invoice.create(full snapshot from order + current company settings) · order.invoice = {id, number, issuedAt}

CANCEL (any status before dispatched)
  if stockCommitted → restock each line (+ ledger order_restock) · stockCommitted=false
  if invoice issued → Counter $inc "credit_note:<FY>" → CreditNote.create(mirror of invoice)
                      invoice.status=cancelled, cancelledBy={creditNote, number, at} · order.creditNotes.push
  release coupon redemption · status=cancelled · activity + audit

PACK UNPAID (confirmed → packed)
  require permissions orders:pack + orders:pack_unpaid AND customer.creditAllowed (else 403 / 409 CREDIT_NOT_ALLOWED)
  status=packed · packedOnCredit=true · activity packed_on_credit · audit action pack_unpaid

RECORD / VERIFY PAYMENT
  Payment(recorded) · recompute amountPaid/paymentStatus from recorded rows
  if fully paid and status=confirmed → payment_received · customer.stats.totalSpent
```

**Order workflow:** `enquiry → confirmed → payment_received → packed → dispatched → delivered`. A credit customer can also go `confirmed → packed` directly (guarded, see above). Any state before `dispatched` can go to `cancelled`. Items, address and pricing are editable only in `enquiry`.

**Checkout mode** (settings switch): website orders are created directly as `confirmed`, so stock is committed at placement. The customer pays by UPI or bank and submits proof. Orders still unpaid after `settings.order.autoCancelUnpaidCheckoutHours` (default 48) are auto-cancelled and restocked. In **enquiry mode**, website orders arrive as `enquiry` and staff confirm them by phone.

---

## 5. API endpoints (`/api/v1`)

Every response uses the envelope `{ success, data, meta?, error?: { code, message, details } }`. Cursor lists return `meta.nextCursor`; offset lists return `meta.page/pageSize/total`.

**System:** `GET /health` (liveness) · `GET /health/ready` (DB ping) · `GET /api/docs` (Swagger UI) · `GET /api/openapi.json`

### Admin API (Bearer access token)

| Area | Method & path | Permission |
|---|---|---|
| **Auth** | `POST /auth/login` (strict rate limit, lockout) · `POST /auth/2fa/verify` (hook) | public |
| | `POST /auth/refresh` (rotation) · `POST /auth/logout` | refresh cookie + Origin check |
| | `POST /auth/forgot-password` · `POST /auth/reset-password` | public |
| | `GET /auth/me` (user + permissions) · `PATCH /auth/me` · `POST /auth/change-password` · `POST /auth/logout-all` | authenticated |
| **Dashboard** | `GET /dashboard/summary` · `/sales-trend` · `/category-sales` · `/state-orders` · `/top-products` · `/season-comparison` | dashboard:read |
| **Categories** | `GET /categories` · `GET /categories/:id` | categories:read |
| | `POST` · `PATCH /:id` (incl. hsn/taxRate) · `PATCH /reorder` · `DELETE /:id` | categories:manage |
| **Products** | `GET /products?q&category&type&isActive&isGreen&lowStock&page` (includes `pendingDemand`) · `GET /products/:id` | products:read |
| | `POST /products` · `POST /products/:id/images` · `DELETE /products/:id/images/:key` | products:create / update |
| | `PATCH /products/:id` (non-price) · `PATCH /products/reorder` | products:update |
| | `PATCH /products/:id/price` (mrp, discount, hsn, taxRate) · `POST /products/bulk-price` (`dryRun` preview) | products:update_price |
| | `POST /products/combos/price-suggestion` | products:read |
| | `DELETE /products/:id` (soft) · `POST /products/:id/restore` | products:delete |
| | `GET /products/import/template` · `POST /products/import?dryRun=` | products:import |
| | `GET /products/export?format=csv\|xlsx` · `GET /products/price-list.pdf` | products:export |
| **Inventory** | `GET /inventory/low-stock` · **`GET /inventory/demand`** (pending enquiry qty vs stock per product) · `GET /inventory/movements` · `GET /products/:id/stock-ledger` | inventory:read |
| | `POST /inventory/movements` (in/out/adjustment with `expectedStockVersion`) · batches CRUD | inventory:adjust |
| **Orders** | `GET /orders?status&paymentStatus&state&from&to&q&cursor` · `GET /orders/:id` · `GET /orders/:id/activity` | orders:read |
| | `POST /orders` · `POST /orders/pricing-preview` | orders:create |
| | `PATCH /orders/:id` (enquiry only, sends `version`) · `POST /orders/:id/comments` | orders:update |
| | `POST /orders/:id/transitions {to, reason?}`. Permissions come from `transitionRequirements()`; Confirm can return 409 `INSUFFICIENT_STOCK`, and pack-unpaid can return 409 `CREDIT_NOT_ALLOWED`. | orders:confirm / pack (+ pack_unpaid) / dispatch / cancel |
| | `PUT /orders/:id/dispatch` | orders:dispatch |
| | `GET /orders/:id/whatsapp-link?template=<event>` → `{ url, message }` | orders:read |
| | `GET /orders/export` · `DELETE /orders/:id` (blocked if invoiced) | orders:export / delete |
| **Invoices & credit notes** | `POST /orders/:id/invoice` (issue once) · `GET /orders/:id/packing-slip.pdf` | orders:invoice |
| | `GET /invoices?from&to&status&cursor` · `GET /invoices/:id` · `GET /invoices/:id/pdf` · `GET /credit-notes` · `GET /credit-notes/:id` · `GET /credit-notes/:id/pdf` | orders:read |
| **Payments** | `GET /orders/:id/payments` · `GET /payments?status=submitted&method&from&to&cursor` | payments:read |
| | `POST /orders/:id/payments` (multipart screenshot; duplicate-UTR warning) · `POST /payments/:id/verify` · `POST /payments/:id/reject` · refund via `kind: refund` | payments:record |
| | `POST /payments/:id/void {reason}` | payments:void |
| **Customers** | `GET /customers` · `GET /customers/:id` · `GET /customers/:id/orders` | customers:read |
| | `POST /customers` · `PATCH /customers/:id` | customers:update |
| | `POST /customers/:id/block` · `/unblock` | customers:block |
| | **`PATCH /customers/:id/credit {creditAllowed, reason}`** (audited) | customers:credit |
| | `DELETE /customers/:id` · `GET /customers/export` | customers:delete / export |
| **Coupons** | `GET /coupons` · `GET /coupons/:id` · `GET /coupons/:id/redemptions` | coupons:read |
| | `POST` · `PATCH /:id` · `DELETE /:id` | coupons:manage |
| **Shipping** | `GET /zones` · `/states` · `/cities` · `/transport-partners` · `POST /shipping/quote` | shipping:read |
| | CRUD zones / cities / transport partners · `PATCH /states/:code` · `PATCH /states` (bulk) | shipping:manage |
| **CMS** | `GET /cms/banners` · `/cms/faqs` · `/cms/pages` · `/cms/storefront` | cms:read |
| | CRUD + reorder · `PATCH /cms/storefront` (open/closed, order mode, announcement) | cms:manage |
| **Reports** | `GET /reports/{sales\|products\|categories\|states\|gst\|payments\|dispatch}`. The GST report covers invoices minus credit notes, HSN-wise and B2B/B2C. | reports:read |
| | same with `&format=xlsx\|pdf` | reports:export |
| **Users** | `GET /users` · `GET /users/:id` | users:read |
| | `POST` · `PATCH /:id` · `/:id/unlock` · `/:id/revoke-sessions` · `/:id/send-reset` · `DELETE /:id` | users:manage |
| **Audit** | `GET /audit-logs?entity&entityId&actor&action&from&to&cursor` | audit:read |
| **Settings** | `GET /settings` | settings:read |
| | `PATCH /settings/{company\|tax\|pricing\|invoice\|payment\|order\|inventory\|notifications}` (sends `version`). Numbering formats are validated (≤16 chars). A `pricing` change returns the affected product count and recomputes prices. | settings:update |
| | `GET/PUT /settings/notification-templates` · CRUD `/seasons` | settings:read / update |
| **Uploads** | `POST /uploads` (MIME sniffing, ≤5 MB, re-encoded; stored on Cloudinary) | upload-capable permission |

### Public API for the website (`/api/v1/public`)

No admin auth. These routes have their own CORS allowlist (`CORS_PUBLIC_ORIGINS`, no credentials), their own rate limits (reads are generous, writes strict per IP and phone), and a captcha hook on every write (`x-captcha-token`, verified by a pluggable `CaptchaVerifier`). Responses only ever expose storefront-safe fields.

| Method & path | Notes |
|---|---|
| `GET /public/store` | name, contact, licence no., GSTIN, isOpen + closedMessage, orderMode, announcement, min order, UPI ID / QR, bank details, safety page slug |
| `GET /public/categories` | active tree |
| `GET /public/products?category&q&isGreen&page` · `GET /public/products/:slug` | active products: price, discount, net price, unit, images, safety info |
| `GET /public/combos` | active gift boxes with contents |
| `GET /public/banners` · `GET /public/faqs` · `GET /public/pages/:slug` | CMS content |
| `GET /public/states` · `POST /public/shipping/quote` | serviceability, min order, delivery charge |
| `POST /public/coupons/validate` | captcha; returns the discount for a cart |
| `POST /public/orders` | captcha. Creates an enquiry, or a confirmed order in checkout mode. **Server re-prices from the catalogue and ignores client prices.** Checks serviceability, min order, blocked customers, and that the store is open. |
| `GET /public/orders/:orderNo?phone=` | order status / tracking (phone must match) |
| `POST /public/orders/:orderNo/payment-proof` | captcha + phone match. Records UTR + screenshot as a `submitted` payment for staff verification. |

---

## 6. RBAC permission matrix

Generated from `packages/shared/src/permissions.ts`. Edit the code, not this table.

| Permission | Super Admin | Admin | Staff (Orders) | Staff (Inventory) | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| `dashboard:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `products:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `products:create` | ✓ | ✓ |  | ✓ |  |
| `products:update` | ✓ | ✓ |  | ✓ |  |
| `products:update_price` | ✓ | ✓ |  |  |  |
| `products:delete` | ✓ | ✓ |  |  |  |
| `products:import` | ✓ | ✓ |  |  |  |
| `products:export` | ✓ | ✓ |  | ✓ |  |
| `categories:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `categories:manage` | ✓ | ✓ |  | ✓ |  |
| `inventory:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory:adjust` | ✓ | ✓ |  | ✓ |  |
| `orders:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `orders:create` | ✓ | ✓ | ✓ |  |  |
| `orders:update` | ✓ | ✓ | ✓ |  |  |
| `orders:confirm` | ✓ | ✓ | ✓ |  |  |
| `orders:pack` | ✓ | ✓ | ✓ | ✓ |  |
| `orders:pack_unpaid` | ✓ | ✓ |  |  |  |
| `orders:dispatch` | ✓ | ✓ | ✓ | ✓ |  |
| `orders:cancel` | ✓ | ✓ | ✓ |  |  |
| `orders:delete` | ✓ |  |  |  |  |
| `orders:invoice` | ✓ | ✓ | ✓ | ✓ |  |
| `orders:export` | ✓ | ✓ |  |  |  |
| `payments:read` | ✓ | ✓ | ✓ |  | ✓ |
| `payments:record` | ✓ | ✓ | ✓ |  |  |
| `payments:void` | ✓ | ✓ |  |  |  |
| `customers:read` | ✓ | ✓ | ✓ |  | ✓ |
| `customers:update` | ✓ | ✓ | ✓ |  |  |
| `customers:block` | ✓ | ✓ |  |  |  |
| `customers:credit` | ✓ | ✓ |  |  |  |
| `customers:delete` | ✓ | ✓ |  |  |  |
| `customers:export` | ✓ | ✓ |  |  |  |
| `coupons:read` | ✓ | ✓ | ✓ |  | ✓ |
| `coupons:manage` | ✓ | ✓ |  |  |  |
| `shipping:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `shipping:manage` | ✓ | ✓ |  |  |  |
| `cms:read` | ✓ | ✓ |  |  | ✓ |
| `cms:manage` | ✓ | ✓ |  |  |  |
| `reports:read` | ✓ | ✓ |  |  | ✓ |
| `reports:export` | ✓ | ✓ |  |  |  |
| `users:read` | ✓ | ✓ |  |  |  |
| `users:manage` | ✓ | ✓ |  |  |  |
| `audit:read` | ✓ | ✓ |  |  |  |
| `settings:read` | ✓ | ✓ |  |  |  |
| `settings:update` | ✓ |  |  |  |  |

Rules beyond the flat matrix (enforced in services):
- Admins can only assign `staff_orders`, `staff_inventory` and `viewer` (`ASSIGNABLE_ROLES`).
- Nobody can delete or demote themselves, and the last active Super Admin can't be removed.
- Order transitions check `transitionRequirements(from, to)`. Packing unpaid also needs `customer.creditAllowed` and is audited.
- The UI hides actions using `GET /auth/me` permissions. The API is the enforcement point.

---

## 7. Decisions log

| # | Topic | Decision (agreed in Phase 1 review) |
|---|---|---|
| 1 | Gift box stock | Own stock (factory pre-packed). `stockMode: own` (default). `components` is reserved and rejected by validation. |
| 2 | Enquiries & stock | No stock held. Stock is deducted on Confirm. Pending enquiry demand shows per product. Confirm with a shortage returns `INSUFFICIENT_STOCK` listing short items. |
| 3 | Packing before payment | Off by default. Needs per-customer `creditAllowed` + permission `orders:pack_unpaid` (Super Admin and Admin only). Every use is audited. |
| 4 | Website | This API also serves the `sakthimaan-crackers` website through `/api/v1/public`: read-only catalogue + enquiry/order submit, separate CORS, rate limits and captcha hook. |
| 5 | GST | Inclusive pricing with back-calculated taxable value. Rate and HSN are configurable (product → category → settings; default 3604 / 18%, pending the accountant's confirmation). Seller is TN (33), so CGST+SGST intra-state and IGST inter-state. |
| 6 | Paid services | Images: **Cloudinary**. Redis: **none**. WhatsApp/SMS: **none**, wa.me links instead. Payment gateway: **none**, manual UPI/bank recording with a configurable UPI QR. Email for password resets goes through a pluggable mailer: console in dev, any SMTP in production (no paid provider needed). Captcha: interface only for now. |
| 7 | Invoice numbering | `SMC/26-27/00042` (15 chars), reset each FY (April–March), never reused or deleted. Credit notes use their own series: **`SMC/CN/26-27/001`**. The suggested `SMC/CN/26-27/0001` is 17 characters, over the GST limit, so the default uses 3 digits (999 per year). `CN/26-27/00001` (14 chars) is an alternative if more are ever needed. |
| 8 | Net-price rounding | `nearest_rupee` (default) or `nearest_paisa`, in `settings.pricing`. Invoices print a round-off line. |
| 9 | Local DB | docker-compose MongoDB is a single-node replica set (`rs0`) with `directConnection=true`. |
