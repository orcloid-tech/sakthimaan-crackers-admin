# sakthimaan-crackers-admin

Admin panel and API for Sakthimaan Crackers: products, orders, inventory, dispatch and reports. React + Node.js + MongoDB.
The API also serves the customer website (`sakthimaan-crackers` repo) under `/api/v1/public`.

Architecture, data model, endpoints and RBAC matrix: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Layout

```
packages/shared   enums, RBAC, pricing/GST, numbering, zod schemas (used by API and admin UI)
apps/api          Express 5 + Mongoose API
apps/admin        React admin panel (Vite, Tailwind, shadcn/ui)
docs/templates    product import template (CSV + Excel) and a guide to send to the client
```

## Local development (no Docker needed)

Requirements: **Node 22+**. MongoDB must be a **replica set** (stock and order updates use transactions).

**1. Pick a database**

- **Recommended: MongoDB Atlas dev cluster.** Atlas clusters are replica sets, so transactions work.
  In Atlas: Database Access → create a user for development. Network Access → add your IP.
  Connect → Drivers → copy the `mongodb+srv://…` string and add a database name, e.g.
  `mongodb+srv://dev-user:<password>@cluster0.xxxxx.mongodb.net/sakthimaan_dev?retryWrites=true&w=majority`.
  Use a separate database (or cluster) from production.
- **Offline fallback:** `npm run db:local -w @sakthimaan/api`. This starts a single-node replica set on port 27017, using the MongoDB binary that the test tooling downloads; data is kept in `apps/api/.local-db`. Keep that terminal open and use
  `MONGODB_URI=mongodb://127.0.0.1:27017/sakthimaan?replicaSet=rs0&directConnection=true`.

**2. Configure and run**

```bash
npm install
cp apps/api/.env.example apps/api/.env
#   edit apps/api/.env: set MONGODB_URI (step 1), JWT_ACCESS_SECRET and ENCRYPTION_KEY
#   (two different values; generate each with the command below)
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm run seed -- --reset      # sample data + one user per role (wipes the database; never in production)
npm run dev                  # API on http://localhost:4000 (docs at /api/docs) + admin on http://localhost:5173
```

Open http://localhost:5173 and sign in with any seeded user. The password for all of them is `Sakthimaan@2026`:

| Role              | Email                       | Sees / can do                                                     |
| ----------------- | --------------------------- | ----------------------------------------------------------------- |
| Super Admin       | `super@sakthimaan.test`     | Everything                                                        |
| Admin             | `admin@sakthimaan.test`     | Everything except company/tax settings                            |
| Staff (Orders)    | `orders@sakthimaan.test`    | Catalogue read-only, orders (coming), customers                   |
| Staff (Inventory) | `inventory@sakthimaan.test` | Products (new ones are **drafts** until approved), stock, batches |
| Viewer            | `viewer@sakthimaan.test`    | Read-only                                                         |

For a real (empty) database, create the first account instead of seeding:
`SUPERADMIN_EMAIL=… SUPERADMIN_NAME=… SUPERADMIN_PASSWORD=… npm run create-super-admin -w @sakthimaan/api`
(on PowerShell set them with `$env:SUPERADMIN_EMAIL="..."` first), then `npm run db:indexes -w @sakthimaan/api`.

The admin needs no configuration in development: Vite proxies `/api` to the API, so both are same-origin.
In production, build it with `VITE_API_URL=https://api.<domain>` (see `apps/admin/.env.example`).

Tests need no database setup: `npm test` starts an in-memory replica set.

Docker images and `docker-compose.yml` are built and verified in GitHub Actions (Linux) from Phase 8.
Docker is not required for development.

## Hosting & cookies (read before deploying)

The admin keeps you signed in with an **httpOnly refresh cookie set by the API**. That only works when the
admin and the API are on the **same registrable domain**, for example:

| Admin                               | API                               | Works?                                                                   |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `https://admin.sakthimaan.in`       | `https://api.sakthimaan.in`       | ✅ same site. Keep `COOKIE_SAMESITE=strict`, leave `COOKIE_DOMAIN` unset |
| `https://sakthi-admin.onrender.com` | `https://sakthi-api.onrender.com` | ❌ different sites                                                       |
| `https://sakthi-admin.vercel.app`   | `https://sakthi-api.onrender.com` | ❌ different sites                                                       |

`onrender.com`, `vercel.app`, `netlify.app`, `railway.app` and similar are on the
[Public Suffix List](https://publicsuffix.org/): each subdomain counts as a separate site. A `SameSite=Strict/Lax`
cookie is then never sent, and `SameSite=None` makes it a third-party cookie, which Safari and Chrome block.
Users would be signed out on every page reload. **Attach custom domains (`admin.` and `api.`) to both services before go-live.**
Deploying both as one Vercel project (`vercel.json` services) avoids this: the admin and `/api/*` share one origin, so leave
`VITE_API_URL` unset, set `NODE_ENV=production` (required), and set `CORS_ADMIN_ORIGINS`, `ADMIN_APP_URL` and `PUBLIC_API_URL` to that domain, with `TRUST_PROXY=1`
and `STORAGE_PROVIDER=cloudinary` (the function filesystem is read-only).
Preview deployments add their own URLs to the admin origins automatically; give the Preview environment its own `MONGODB_URI`.
The API logs a warning at startup when an admin origin is on one of these domains, and refuses a `COOKIE_DOMAIN` on them.

Relevant settings (`apps/api/.env`): `CORS_ADMIN_ORIGINS`, `COOKIE_SAMESITE` (default `strict`), `COOKIE_SECURE`
(forced on in production), `COOKIE_DOMAIN` (default unset, so the cookie is host-only on the API host; this is the safest
option and is all the refresh flow needs).

## Scripts (repo root)

| Command                                                 | What it does                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                                           | API (:4000) and admin (:5173) together                                   |
| `npm run seed -- --reset`                               | Wipe and load sample data with one user per role (refuses production)    |
| `npm test`                                              | All tests (in-memory MongoDB replica set; nothing to install)            |
| `npm run typecheck` / `npm run lint` / `npm run format` | Type check, ESLint, Prettier                                             |
| `npm run check`                                         | Lint + format check + typecheck + tests (what CI will run)               |
| `npm run build`                                         | Build shared, API and admin (`apps/*/dist`)                              |
| `npm run db:indexes -w @sakthimaan/api`                 | Sync MongoDB indexes (run on every deploy; production has autoIndex off) |
| `npm run db:local -w @sakthimaan/api`                   | Offline local MongoDB replica set (dev fallback)                         |
| `npm run templates -w @sakthimaan/api`                  | Regenerate docs/templates from the shared import column definitions      |
