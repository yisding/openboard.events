# Database schema ownership

The ordered SQL files in `drizzle/` are the authoritative product schema. The
TypeScript modules in `src/db/schema` are the query model used by Drizzle ORM;
they must describe every runtime table, enum, and column, but they are not a
second migration source.

Run the drift gate with:

```bash
pnpm schema:check
```

The gate creates a clean in-memory Postgres database, applies all 45 entries in
`drizzle/meta/_journal.json`, and compares the result with Drizzle's runtime
metadata. It checks:

- all 91 tables and 802 modeled columns, including type, nullability, and the
  presence of a database default;
- all 33 enum names and their ordered values;
- primary keys, checks, foreign keys, unique constraints, and indexes;
- every SQL-only view, function, trigger, advanced constraint, and normalized
  index definition (columns, order, null placement, uniqueness, and predicate).

`architecture/schema-sql-only-allowlist.json` is the exact reviewed difference
ledger. CI fails when an entry appears or becomes stale. Its current intentional
differences include:

- `users.password_hash`, retained only as a constrained-null compatibility
  column after fallback authentication was retired;
- composite tenant/event foreign keys that supersede simpler query-model
  references;
- SQL checks, partial or specialized indexes, eight reporting views, fifteen
  functions, and thirteen triggers that Drizzle's query metadata does not own;
- 46 simple query-model foreign keys whose database enforcement is replaced by
  stronger composite keys, plus the `admin_sessions.token` query uniqueness
  represented in SQL as a unique index.

Do not regenerate the ledger mechanically as part of an unrelated change. Run
`pnpm schema:allowlist`, review each added and removed line against the migration,
then update the committed JSON only for an intentional representation boundary.

## Migration-backed test fixtures

Tests that claim to use the product schema must call `applyProductMigrations`
from `scripts/lib/product-migrations.ts`. The helper validates that the numbered
SQL files and journal have the same ordered entries before applying every one.
This prevents a hand-picked subset from silently testing an obsolete schema.

Focused migration tests may still apply a minimal before/after sequence when
the subset itself is the behavior under test. Such a test should say which
migration transition it isolates; it is not a product-schema fixture.

## Change workflow

1. Add the next immutable SQL migration and journal entry.
2. Update `src/db/schema` for every query-visible table, enum, or column change.
3. Use the full-journal fixture for product-schema tests.
4. Run `pnpm schema:check` and the focused database tests.
5. If the migration adds an intentionally SQL-only object, review and update
   the exact allowlist in the same pull request.

Applied migrations are never edited or rolled back in place. Recovery is a new
forward migration, consistent with the deployment and rollback runbooks.
