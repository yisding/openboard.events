import { sql } from "drizzle-orm";
import { withTx, type TxDb } from "@/db/client";
import { seedAgenda } from "./agenda";
import { seedComms } from "./comms";
import { seedContacts } from "./contacts";
import { seedEvaluation } from "./evaluation";
import { seedEvents } from "./events";
import { seedForms } from "./forms";
import { seedPortal } from "./portal";
import { seedSubmissions } from "./submissions";
import { resolveSeedHeadshotTarget, uploadSeedHeadshots } from "./upload-headshots";
import { seedId } from "./lib/ids";
import { SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID, type SeedCtx, type SeedModule } from "./lib/helpers";
import { assertDatabaseAllowsSeed, assertSafeSeedTarget } from "./lib/safety";

/**
 * `pnpm seed` fills a database with the demo world in one idempotent run.
 *
 * Insertion order is documented law — each step depends on ids the previous one
 * created. Reordering this array is a data bug, not a style choice.
 */
const MODULES: Array<{ name: string; run: SeedModule }> = [
  { name: "events", run: seedEvents },
  { name: "contacts", run: seedContacts },
  { name: "forms", run: seedForms },
  { name: "submissions", run: seedSubmissions },
  { name: "evaluation", run: seedEvaluation },
  { name: "agenda", run: seedAgenda },
  { name: "portal", run: seedPortal },
  { name: "comms", run: seedComms },
];

/** Printed after every run, so a judge always has current credentials. */
const CREDENTIALS = [
  ["Organizer (owner)", "organizer@openboard.dev", "password from BOOTSTRAP_ADMIN_PASSWORD (pnpm admin:bootstrap)"],
  ["Reviewer", "reviewer@openboard.dev", "password from BOOTSTRAP_REVIEWER_PASSWORD"],
  ["Speaker", "a seeded team-owned address", "signs in through the normal portal OTP challenge"],
] as const;

const wipe = process.argv.includes("--wipe");

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * FK-safe by construction: one TRUNCATE over every base table in `public`, which
 * excludes the views and the drizzle journal (it lives in its own schema).
 */
async function wipeAll(tx: TxDb): Promise<number> {
  const tables = await tx.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const names = (tables.rows ?? []).map((row) => row.table_name);
  if (names.length === 0) return 0;
  const list = names.map((name) => `public.${quoteIdent(name)}`).join(", ");
  await tx.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
  return names.length;
}

/** Set once per database at provisioning: ALTER DATABASE … SET app.environment. */
async function databaseIdentity(tx: TxDb): Promise<string | null> {
  const result = await tx.execute<{ environment: string | null }>(sql`SELECT current_setting('app.environment', true) AS environment`);
  const value = result.rows?.[0]?.environment?.trim();
  return value ? value : null;
}

async function rowCounts(tx: TxDb): Promise<Array<{ table: string; rows: number }>> {
  const tables = await tx.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const counts: Array<{ table: string; rows: number }> = [];
  for (const row of tables.rows ?? []) {
    const result = await tx.execute<{ count: string }>(sql.raw(`SELECT count(*)::text AS count FROM public.${quoteIdent(row.table_name)}`));
    counts.push({ table: row.table_name, rows: Number(result.rows?.[0]?.count ?? 0) });
  }
  return counts;
}

// tsx transforms this to CJS, where top-level await is not available, so the
// whole run lives in main().
async function main(): Promise<void> {
  assertSafeSeedTarget(process.env);

  const startedAt = Date.now();
  // The one command-line transaction: a partial seed never lands. This is
  // resolution #4's explicit non-runtime exception; no request or job path copies it.
  const summary = await withTx(async (tx) => {
    // Inside the transaction and before the wipe: a refusal rolls back having
    // changed nothing, and it checks the database's own identity rather than the
    // operator's claim about it.
    await assertDatabaseAllowsSeed(() => databaseIdentity(tx), process.env);
    // R2 cannot participate in this transaction, but doing the deterministic
    // uploads after database identity verification and before any DB write
    // guarantees committed file rows never point at objects this run skipped.
    // A later DB failure leaves only harmless overwrite-safe objects.
    uploadSeedHeadshots(resolveSeedHeadshotTarget(process.env));
    if (wipe) {
      const truncated = await wipeAll(tx);
      console.log(`wiped ${truncated} tables`);
    }
    const now = new Date();
    for (const seedModule of MODULES) {
      const ctx: SeedCtx = {
        tx,
        now,
        eventId: SEEDED_EVENT_ID,
        emptyEventId: SEEDED_EMPTY_EVENT_ID,
        id: seedId,
        log: (msg: string) => console.log(`  ${seedModule.name}: ${msg}`),
      };
      await seedModule.run(ctx);
    }
    return rowCounts(tx);
  });

  const populated = summary.filter((row) => row.rows > 0);
  console.log("");
  console.log(populated.length > 0 ? "rows per table:" : "rows per table: (nothing seeded yet)");
  for (const row of populated) console.log(`  ${row.table.padEnd(28)} ${row.rows}`);

  console.log("");
  if (populated.length === 0) {
    console.log("credentials: none — no seed module has created an account yet, so nothing can sign in");
  } else {
    console.log("credentials:");
    for (const [role, who, how] of CREDENTIALS) console.log(`  ${role.padEnd(18)} ${who.padEnd(32)} ${how}`);
  }
  console.log("");
  console.log(`event id       ${SEEDED_EVENT_ID}`);
  console.log(`empty event id ${SEEDED_EMPTY_EVENT_ID}`);
  console.log(`seed complete in ${Date.now() - startedAt} ms${wipe ? " (wiped first)" : ""}`);
}

main().catch((error: unknown) => {
  // Print the cause as well: a driver error's message is often empty while
  // everything useful hangs off `cause`, and a seed that fails silently is a
  // seed nobody can fix.
  if (error instanceof Error) {
    console.error(error.message || error.name);
    if (error.cause) console.error("cause:", error.cause);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
