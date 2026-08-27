# CLAUDE.md

Read this first. It's the map of the system so you don't have to re-derive it
every session.

## What this is

**Vírgula Contábil – Portal do Cliente**: a Brazilian accounting firm's portal.
Two audiences in one app:

- **Cliente** (the accounting firm's customers): sees their fiscal documents /
  tax slips ("guias"), due dates, a digital vault, uploads bank statements,
  fills in monthly billing figures, talks to the accountant.
- **Contador** (the firm, a single admin account): manages clients, pushes
  documents, runs the inbox of client uploads, sends notifications, configures
  the SERPRO integration.

Goal: give clients a calm, mobile-first view of "what do I owe, when, and is my
company regular?" and give the accountant one place to service them.

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | React 19 SPA, Vite 6, react-router-dom 7, Tailwind v4 (`@theme` in `src/index.css`), lucide-react icons, Recharts, framer-motion (`motion`) |
| Backend | Express 4, single process, `server.ts` at repo root |
| DB | Postgres via Drizzle ORM (`drizzle-orm/node-postgres`) |
| Auth | JWT (client + accountant); per-client `integrationHash` bearer token for machine callers |
| Delivery | PWA (`public/sw.js`, `manifest.json`) + Capacitor Android/iOS wrapper |
| Push | `web-push` (browsers) + Firebase Admin FCM (mobile) |
| Email | Nodemailer (SMTP) + Resend |
| External | SERPRO **Integra Contador** API for generating DAS / DCTFWEB guias |
| Deploy | Docker → Cloud Run / EasyPanel |

## Run / check

```bash
npm run dev        # db:migrate (predev hook) then tsx server.ts on :3000 (needs DATABASE_URL)
npm run lint       # tsc --noEmit — always run before committing
npm test           # vitest, server-only (src/server/**/*.test.ts); migrations.test.ts uses pglite
npm run build      # vite build + esbuild -> dist/server.cjs + dist/migrate.cjs
npm start          # db:migrate (prestart hook via dist/migrate.cjs) then node dist/server.cjs
npm run db:generate / db:migrate / db:seed / db:studio   # Drizzle (see MIGRATIONS.md)
```

CI (`.github/workflows`) runs lint + test + build on push/PR to `main`.
Local dev without a real DB: point `DATABASE_URL` at a throwaway Postgres
(Neon/Supabase free tier work). `npm run db:migrate` builds the schema;
`npm run db:seed` adds two demo clients (CNPJ `12.345.678/0001-99`,
password = same CNPJ).

## Layout

```
server.ts                     bootstrap: env validation, helmet, CORS, static, error handler
src/
  App.tsx                     all routes
  main.tsx
  index.css                   Tailwind @theme tokens (colors, fonts)
  lib/
    apiClient.ts              apiFetch() — ALWAYS use this for API calls (adds JWT, handles 401)
    utils.ts                  cn(), handleFileAction()
  components/
    Layouts.tsx               ClientLayout + AccountantLayout (route guards + chrome)
    Logo.tsx                   brand wordmark — use instead of ad-hoc markup
    Skeleton.tsx               loading placeholders
  pages/
    Auth.tsx                  /login (client) + /admin/login (accountant)
    client/                   Dashboard, Overdue, Vault, MyUploads, SetupProfile
      dashboard/*             Dashboard sub-components (Kpi, DueDates, Charts, ...)
    accountant/              Dashboard, ClientsList, ClientDetail, Notifications,
                             FileGallery, Devices, Settings, Audit
  server/
    db.ts                    pg Pool + drizzle; initDb() only checks connectivity now
    schema.ts                Drizzle schema — SINGLE SOURCE OF TRUTH for tables
    env.ts                   validateEnv() (fail-fast in prod), corsOrigins(), PORT
    types.ts                 Express.Request augmentation + getAuth/getClientId/getIntegrationClient
    middleware/              auth.ts (verify*Auth), rateLimit.ts, validate.ts (zod)
    routes/
      index.ts               setupRoutes() mounts everything
      auth.routes.ts         login, forgot/reset password
      client.routes.ts       /api/client/*  + /api/pendencies/guia/* (SERPRO)
      files.routes.ts        /api/documents/:id/file  (authenticated document download)
      accountant.routes.ts   /api/accountant/*  (client CRUD, files, billing, SERPRO config)
      integration.routes.ts  /api/integration/*  (integrationHash auth)
      webhook.routes.ts      /api/webhook/*  (external doc push, hash-authed)
      notifications.routes.ts push subscribe + scheduled-notification rules
    schemas/validation.ts    zod request schemas — EVERY write endpoint has one
    dto/client.ts            clientSelfDTO / clientAdminDTO / clientIntegrationDTO — never return a raw client row
    services/
      billing.ts             upsertBilling() — the one place billing rows are written
      audit.ts               logAudit(req, action, {...}) — call on sensitive accountant actions
      password.ts            hashPassword / verifyPassword (bcrypt + legacy-plaintext upgrade)
      resetCode.ts           password-recovery one-time code (CSPRNG, sha256+pepper, attempt cap)
      integrationToken.ts    generate/hash/lookup integration tokens (digest at rest, plaintext fallback)
      secretbox.ts           encryptSecret/decryptSecret (AES-256-GCM, SECRETS_KEY) for SERPRO creds
      upload.ts              multer config, sanitizeFilename, extension allow-list, validateUploadedFileContent
      fileType.ts            magic-byte sniffing (contentMatchesExtension)
      files.ts               resolveUploadPath / resolveGuiaPdfPath (traversal-safe) + streamers
      mailer.ts, push.ts, serpro.ts, notificationSweeper.ts
  lib/cnpj.ts                normalizeCnpj / formatCnpj / cnpjMatches (shared client+server)
drizzle/                     migrations — SINGLE SOURCE OF TRUTH. 0000_baseline + 0001+ + reconcile-legacy.sql
scripts/                     migrate.ts (db:migrate), seed.ts (db:seed), migrate-passwords.ts
```

## Conventions & gotchas

- **API calls from the frontend go through `apiFetch(endpoint, opts, "client"|"accountant")`.**
  It injects the right JWT and redirects to the login on 401. Don't hand-roll
  `fetch` with an `Authorization` header.
- **Auth is header-only** — `Authorization: Bearer <jwt>`. The `?token=` query
  param was removed everywhere. Documents open via `openDocument(docId, ...)`
  (authenticated fetch → blob); pdf.js gets `documentAuthHeaders()`.
- **Never return a raw `clients` / `serpro_config` row** to the browser. Use a
  DTO (`dto/client.ts`) or a sanitized object — password hash, integration
  token (digest), reset-code hash, SERPRO secrets must never leave the server.
- **Server route handlers**: guard with `verify*Auth`, validate bodies with
  `validateBody(zodSchema)` (there's a schema for every write endpoint), read
  identity via `getClientId(req)` / `getIntegrationClient(req)` / `getAuth(req)`
  (typed; no `(req as any)`).
- **Uploads**: `upload.single(...)`, then `validateUploadedFileContent`
  (magic-byte check), then `validateBody(...)`, then the handler.
- **Schema changes**: edit `src/server/schema.ts`, then `npm run db:generate`,
  review the generated `drizzle/NNNN_*.sql`, commit both. `npm run db:migrate`
  applies them (auto-run by the `predev`/`prestart` hooks). The server does NOT
  touch the schema at boot. See `MIGRATIONS.md`.
- **CNPJ** is stored *digits-only* (`12345678000199`). `normalizeCnpj()` before
  insert/lookup, `formatCnpj()` for display (`src/lib/cnpj.ts`). Client lookups
  still go through `findClientsByCnpj` (normalized-in-SQL), never a full scan.
- **billing_data** has the current "services" model
  (`servicesRevenue/salesRevenue/totalIncomes/servicesTaken`) plus legacy
  `revenue/expenses/payroll` kept in sync — always write via `upsertBilling()`.
- **Two dashboards named `Dashboard.tsx`** — `pages/client/` vs `pages/accountant/`.
- **Password recovery**: `POST /api/auth/client/forgot-password` returns an
  identical 200 for every case (found / not found / no email) — no CNPJ oracle;
  the code work happens after the response. `reset-password` gives one generic
  error for every rejection and burns the code after `RESET_CODE_MAX_ATTEMPTS`.
- **Env**: prod refuses to start without real `JWT_SECRET`, `ADMIN`, `PASSWORD`,
  `DATABASE_URL` (`src/server/env.ts`). `CORS_ORIGINS` required in prod.
  Recommended: `SECRETS_KEY` (encrypts SERPRO creds at rest — dedicated key,
  NOT `JWT_SECRET`), `VAPID_*`. `TRUST_PROXY` defaults to `1` (never `true`).
  `PASSWORD_RESET_PEPPER` optional (falls back to `JWT_SECRET`).
- **Admin login** is env-based (`ADMIN`/`PASSWORD`), not a DB row.
- **File uploads**: 10 MB cap, one file, extension allow-list
  (`ALLOWED_UPLOAD_EXTENSIONS`), random stored name (no overwrite), names run
  through `sanitizeFilename()`.
- **Serving documents**: `/uploads` is NOT public. Client documents are
  downloaded only via `GET /api/documents/:id/file` (auth + per-document
  authorization; client sees only its own, accountant sees all). The path is
  resolved server-side from `documents.file_url` — never from the request.
  Frontend builds the URL with `documentFileUrl(doc.id, { download?, as? })`
  from `lib/apiClient.ts`. SERPRO guia PDFs also stream through
  `GET /api/pendencies/guia/:guiaId/pdf` (same auth model).
- Tests are **server-only**; there is no frontend test setup.

## Domain vocabulary

- **guia** – a tax payment slip (DAS for Simples Nacional, DCTFWEB for INSS).
  Generated via SERPRO Integra Contador; the PDF carries a PIX copia-e-cola.
- **competência** – the reference month of an obligation, `MM/YYYY`.
- **regularidade** – a client's compliance status: `green` / `warning` / `red`.
- **SITFIS** – Receita Federal tax-situation report, arrives via webhook.
- **pendência / solicitação** – a client asking the accountant to (re)calculate.
