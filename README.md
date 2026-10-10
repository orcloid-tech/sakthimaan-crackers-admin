# sakthimaan-crackers-admin

Admin panel and API for Sakthimaan Crackers: products, orders, inventory, dispatch and reports. React + Node.js + MongoDB.
The API also serves the customer website (`sakthimaan-crackers` repo) under `/api/v1/public`.

Architecture, data model, endpoints and RBAC matrix: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Layout

```
packages/shared   enums, RBAC, pricing/GST, numbering, zod schemas (used by API and admin UI)
apps/api          Express 5 + Mongoose API
apps/admin        React admin panel (phase 6)
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
#   edit apps/api/.env: set MONGODB_URI (step 1) and JWT_ACCESS_SECRET
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm run db:indexes -w @sakthimaan/api                 # create indexes (first run / after schema changes)
SUPERADMIN_EMAIL=you@example.com SUPERADMIN_NAME="Your Name" SUPERADMIN_PASSWORD='a-long-passphrase-123' \
  npm run create-super-admin -w @sakthimaan/api
npm run dev -w @sakthimaan/api                        # http://localhost:4000, API docs at /api/docs
```

On Windows PowerShell, set the three `SUPERADMIN_*` variables with `$env:SUPERADMIN_EMAIL="..."` first,
or put them in `apps/api/.env` temporarily.

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
The API logs a warning at startup when an admin origin is on one of these domains, and refuses a `COOKIE_DOMAIN` on them.

Relevant settings (`apps/api/.env`): `CORS_ADMIN_ORIGINS`, `COOKIE_SAMESITE` (default `strict`), `COOKIE_SECURE`
(forced on in production), `COOKIE_DOMAIN` (default unset, so the cookie is host-only on the API host; this is the safest
option and is all the refresh flow needs).

## Scripts (repo root)

| Command                                                 | What it does                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm test`                                              | All tests (in-memory MongoDB replica set; nothing to install)            |
| `npm run typecheck` / `npm run lint` / `npm run format` | Type check, ESLint, Prettier                                             |
| `npm run check`                                         | Lint + format check + typecheck + tests (what CI will run)               |
| `npm run build`                                         | Build shared + API to `dist/`                                            |
| `npm run db:indexes -w @sakthimaan/api`                 | Sync MongoDB indexes (run on every deploy; production has autoIndex off) |
| `npm run db:local -w @sakthimaan/api`                   | Offline local MongoDB replica set (dev fallback)                         |
