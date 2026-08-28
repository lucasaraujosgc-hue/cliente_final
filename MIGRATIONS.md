# Database migrations

**Drizzle migrations are the single source of truth for the schema.** The
server never creates or alters tables at boot.

- Schema definition: [`src/server/schema.ts`](src/server/schema.ts)
- Migration files: [`drizzle/`](drizzle/)
- Runner: [`scripts/migrate.ts`](scripts/migrate.ts) → `npm run db:migrate`

## Everyday workflow

```bash
# 1. edit src/server/schema.ts
npm run db:generate     # writes drizzle/NNNN_<name>.sql + updates meta/
# 2. review the generated SQL, commit it together with the schema change
npm run db:migrate      # apply locally
```

`npm run db:migrate` is safe to run repeatedly — it only applies what's
pending. It also runs automatically:

| When | How |
|------|-----|
| local dev | `predev` hook (`npm run dev` → migrate → start) |
| production | `prestart` hook (`npm start` → `node dist/migrate.cjs` → server) |
| deploy | run `npm run db:migrate` (or `node dist/migrate.cjs`) as an explicit release step before routing traffic |

The Docker image bundles the runner to `dist/migrate.cjs` and copies
`drizzle/` so the SQL files are available at runtime.

## The legacy bridge (one-time, automatic)

Databases created by the **old** `src/server/db.ts` (which did
`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` on every boot) have the tables
but no `drizzle.__drizzle_migrations` history. The first `db:migrate` against
such a database:

1. detects it (`clients` exists, migration history empty),
2. runs [`drizzle/reconcile-legacy.sql`](drizzle/reconcile-legacy.sql) in a
   transaction — fully idempotent and additive: creates any missing table
   (`audit_log`), adds any missing column, renames `reset_token` →
   `reset_code_hash` / `reset_token_expires` → `reset_code_expires`, converts
   `json` → `jsonb` where the schema expects it, and normalises every
   `client_id` foreign key to `ON DELETE CASCADE` with the drizzle-standard
   name,
3. marks `0000_baseline` as applied,
4. then applies `0001+` normally.

Fresh/empty databases skip step 2 and just get `0000_baseline.sql`.

**It never drops a table and never drops a data column.** The reconcile is
exercised by [`src/server/services/__tests__/migrations.test.ts`](src/server/services/__tests__/migrations.test.ts)
against a real Postgres engine (pglite), including a data-preservation check.

> Before the first production deploy of this change, run `npm run db:migrate`
> against a **copy** of the production database and confirm
> `[migrate] schema verified` with no warnings.

## Migrations after the baseline

| # | What | Notes |
|---|------|-------|
| `0001_integration_hash_digest` | adds `clients.integration_hash_digest`, backfills the sha256 of the existing plaintext `integration_hash` | **Transition**: both columns stay; `findClientByIntegrationToken` matches either so no webhook integration breaks. Once every integration has re-saved / re-generated its token, a later migration can drop `integration_hash`. |
| `0002_normalize_cnpj` | `clients.cnpj` → digits-only (14) | Aborts (no half-apply) if stripping punctuation would collide two rows. Formatting is now a display concern (`src/lib/cnpj.ts`). |
| `0003_auth_sessions` | creates `auth_sessions` (one row per login: hashed rotating refresh token, reuse-detection column, expiry, revocation) | New table, `CREATE TABLE IF NOT EXISTS` so it's re-runnable. No FK — the accountant has no `clients` row and the delete handler clears client sessions explicitly. See `docs/SECURITY.md`. |

## Schema facts worth knowing

- FKs: every `client_id` → `clients.id` is `ON DELETE CASCADE`. `audit_log`
  deliberately has **no** FK so the trail survives client deletion.
- Unique: `clients.cnpj` (digits-only), `clients.integration_hash`,
  `clients.integration_hash_digest`.
- `json` vs `jsonb`: `documents.extracted_data` and
  `subscriptions.subscription_object` are `jsonb`;
  `clients.notification_preferences` and `audit_log.metadata` are `json`.
- Defaults: `billing_data.*` money columns default `0`;
  `clients.reset_code_attempts` defaults `0`;
  `clients.notification_preferences` has a JSON default.
- Secrets: `serpro_config.consumer_secret` / `cert_senha` are stored
  AES-256-GCM-encrypted when `SECRETS_KEY` is set (transparent to the schema —
  they're still `text`, just `enc:v1:…`).

## Seeding (dev only)

```bash
npm run db:seed   # refuses to run if NODE_ENV=production or clients table is non-empty
```
