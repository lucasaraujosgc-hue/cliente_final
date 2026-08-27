# Database migrations

The schema lives in [`src/server/schema.ts`](src/server/schema.ts) (Drizzle ORM).

## Current state

Two mechanisms exist during the transition:

| Mechanism | Where | Status |
|-----------|-------|--------|
| `initDb()` | [`src/server/db.ts`](src/server/db.ts) | **Active** — runs on every server start, `CREATE TABLE IF NOT EXISTS` + idempotent `ALTER`s. Safe but doesn't track versions. |
| Drizzle migrations | [`drizzle/`](drizzle/) + [`scripts/migrate.ts`](scripts/migrate.ts) | **Scaffolded** — `0000_baseline.sql` matches what `initDb` builds. |

## Everyday workflow

```bash
# 1. edit src/server/schema.ts
# 2. generate a migration file
npm run db:generate
# 3. review + commit drizzle/NNNN_*.sql and drizzle/meta/*
# 4. apply it
npm run db:migrate
```

`npm run db:migrate` is safe to run repeatedly. On a database that predates
migrations it marks `0000_baseline` as already applied (see the baseline-adoption
logic in `scripts/migrate.ts`) and only runs `0001+`. On a fresh empty database
it runs everything from `0000`.

## Cutover (one-time, deliberate)

When you're ready to make migrations the single source of truth:

1. Run `npm run db:migrate` against production once (adopts the baseline).
2. Add `npm run db:migrate` as a release step in the deploy pipeline
   (before the new container serves traffic).
3. Reduce `initDb()` to just the seed / "remove test companies" block, or
   delete it entirely.

Until then, keep new columns represented **both** in `schema.ts` and as an
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `initDb()` so both paths agree.
