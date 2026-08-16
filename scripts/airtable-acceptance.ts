import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/db/client";
import {
  chooseAirtableBaseIn,
  disconnectAirtableIn,
  runAirtableSyncForEventIn,
  updateAirtableOptionsIn,
  validateAirtableTokenIn,
  type SyncRunStats,
} from "@/features/airtable";
import { deleteSessionIn, saveSessionIn } from "@/features/agenda/server/mutations";
import type { EventId, SessionId } from "@/shared/contracts";
import { sessionIdSchema } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { SEEDED_EVENT_ID } from "./seed/lib/helpers";

/**
 * The one thing in this repository that talks to the real Airtable API.
 *
 * Never run in CI, never run against a deployed environment (`src/shared/lib/env.ts`'s
 * `.superRefine` already refuses to parse `AIRTABLE_API_KEY` outside `APP_ENV=local`, so
 * `getEnv()` throws before this script does anything if that guard is ever bypassed) — this is a
 * developer, by hand, against their own Airtable account and their own local `pnpm seed` database.
 *
 * What it proves, in order:
 *
 * 1. `whoami` succeeds and the token's scopes are good enough to connect.
 * 2. A scratch base can be created and its schema built to match `TABLE_PLANS`.
 * 3. Pushing the seeded fixture event succeeds.
 * 4. **Pushing it again makes zero Airtable calls** — the headline idempotency claim. Nothing
 *    changed, so the Postgres anti-join finds nothing to send.
 * 5. Deleting one record and pushing a third time issues **exactly one** delete call.
 *
 * The transcript this prints is the artefact that justifies flipping `AIRTABLE_CRON` to `"1"` in
 * `wrangler.jsonc` — see `docs/airtable.md`'s launch runbook. That flip stays a separate,
 * deliberate commit; this script only produces the evidence for it.
 *
 * Deviation from the original design sketch: rather than deleting a session that
 * `pnpm seed` already created (destructive to a developer's demo world, and not restorable
 * without a full re-seed), this script creates its own disposable scratch session, pushes it,
 * deletes it, and asserts the one resulting delete call. Every other seeded row is read, never
 * written.
 */

const CONFIRM_PHRASE = "mutate-local-seed-data";

type AcceptanceConfig = {
  apiKey: string;
  workspaceId: string;
};

function readConfig(): AcceptanceConfig {
  const env = getEnv();
  if (!env.AIRTABLE_API_KEY) {
    throw new Error(
      "AIRTABLE_API_KEY is not set. Put a personal access token in .dev.vars (never commit it) "
      + "and re-run — this script never reads a token from anywhere else.",
    );
  }
  const workspaceId = process.env.AIRTABLE_ACCEPTANCE_WORKSPACE_ID;
  if (!workspaceId || !/^wsp[A-Za-z0-9]+$/u.test(workspaceId)) {
    throw new Error(
      "Set AIRTABLE_ACCEPTANCE_WORKSPACE_ID to the wsp… id of an Airtable workspace this token "
      + "can create bases in (the wsp… segment of the URL while looking at that workspace).",
    );
  }
  if (process.env.AIRTABLE_ACCEPTANCE_CONFIRM !== CONFIRM_PHRASE) {
    throw new Error(
      `This creates a real Airtable base and writes to your local pnpm seed database. `
      + `Set AIRTABLE_ACCEPTANCE_CONFIRM=${CONFIRM_PHRASE} once you mean it.`,
    );
  }
  return { apiKey: env.AIRTABLE_API_KEY, workspaceId };
}

function printStats(label: string, stats: SyncRunStats): void {
  console.log(`\n${label}`);
  console.log(
    `  tables=${stats.tables} apiCalls=${stats.apiCalls} rateLimited=${stats.rateLimited} `
    + `created=${stats.created} updated=${stats.updated} unchanged=${stats.unchanged} `
    + `deleted=${stats.deleted} orphans=${stats.orphans} purgeHeld=${stats.purgeHeld} `
    + `deferred=${stats.deferred}`,
  );
}

async function createScratchSession(eventId: EventId): Promise<{ id: SessionId; rowVersion: number }> {
  const creationId = sessionIdSchema.parse(crypto.randomUUID());
  const session = await saveSessionIn(db, eventId, {
    creationId,
    title: `Airtable acceptance scratch session — safe to delete (${new Date().toISOString()})`,
    descriptionHtml: "",
    status: "draft",
  });
  return { id: session.id, rowVersion: session.rowVersion };
}

async function run(): Promise<void> {
  const config = readConfig();
  const eventId = SEEDED_EVENT_ID;
  let scratchSession: { id: SessionId; rowVersion: number } | null = null;

  try {
    console.log("1/6 whoami + scope check…");
    const { verdict } = await validateAirtableTokenIn(db, eventId, {
      pat: config.apiKey,
      connectedByUserId: null,
    });
    console.log(`  connected as ${verdict.accountEmail ?? `usr…${verdict.airtableUserId.slice(-4)}`}`);
    console.log(`  scopes: ${verdict.scopes.join(", ")}`);
    if (!verdict.canConnect) {
      throw new Error(`token is missing required scope(s): ${verdict.missingRequired.join(", ")}`);
    }
    if (!verdict.canManageSchema) {
      console.warn("  warning: no schema.bases:write — base creation and schema repair will fail");
    }

    console.log("2/6 creating a scratch base and building its schema…");
    const baseName = `Openboard acceptance scratch ${new Date().toISOString()}`;
    const chosen = await chooseAirtableBaseIn(db, eventId, {
      action: "create",
      workspaceId: config.workspaceId,
      name: baseName,
    });
    if (!chosen.schema.ok) {
      throw new Error(`ensureBaseSchema did not complete: ${chosen.schema.reason} — ${JSON.stringify(chosen.schema.issues)}`);
    }
    console.log(`  base: ${chosen.summary.baseName} (${chosen.summary.baseId})`);
    console.log(`  https://airtable.com/${chosen.summary.baseId}`);

    console.log("3/6 creating a disposable scratch session to delete later…");
    scratchSession = await createScratchSession(eventId);

    console.log("4/6 first sync — pushes the seeded fixture event…");
    const first = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual" });
    printStats("first run", first.stats);
    if (first.status !== "success") {
      throw new Error(`first sync ended ${first.status} (errorKey=${first.errorKey ?? "none"}), expected success`);
    }

    console.log("5/6 second sync — nothing changed, must make zero Airtable calls…");
    const second = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual" });
    printStats("second run", second.stats);
    if (second.stats.apiCalls !== 0) {
      throw new Error(`second sync made ${second.stats.apiCalls} Airtable call(s); idempotency claim failed`);
    }

    console.log("6/6 delete the scratch session, enable purge, sync a third time…");
    await updateAirtableOptionsIn(db, eventId, { pruneRemoved: true });
    await deleteSessionIn(db, eventId, scratchSession.id, scratchSession.rowVersion);
    scratchSession = null;
    const third = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual" });
    printStats("third run", third.stats);
    if (third.stats.deleted !== 1) {
      throw new Error(`third sync deleted ${third.stats.deleted} record(s), expected exactly 1`);
    }

    console.log(JSON.stringify({
      ok: true,
      baseId: chosen.summary.baseId,
      firstRunApiCalls: first.stats.apiCalls,
      secondRunApiCalls: second.stats.apiCalls,
      thirdRunDeleted: third.stats.deleted,
    }));
    console.log(
      "\nAll assertions passed. Airtable has no API to delete a base — open "
      + `https://airtable.com/${chosen.summary.baseId} and delete "${baseName}" by hand when done with it.`,
    );
  } finally {
    // A scratch session left behind on a thrown assertion is real seed-database
    // drift; clean it up whenever it is still ours to clean up.
    if (scratchSession) {
      await deleteSessionIn(db, eventId, scratchSession.id, scratchSession.rowVersion).catch(() => undefined);
    }
    // Disconnecting also clears `airtable_sync_state`, so re-running this
    // script starts clean rather than colliding with the previous connection.
    await disconnectAirtableIn(db, eventId).catch(() => undefined);
  }
}

/*
 * Resolved module path against `argv[1]`, rather than the
 * `basename(argv[1]) === "<this file>.ts"` guard the other scripts under
 * `scripts/` use.
 *
 * Everywhere else, a guard that fails to match is harmless — the script simply
 * was not the entry point that run. Here it is the worst outcome available:
 * this script exists to produce the transcript an operator files as evidence
 * that M39 was accepted, and a silent exit 0 having contacted nothing is
 * indistinguishable from a clean run to anything reading an exit code. The
 * name-based test says "not launched under my file name", which is true both of
 * an ordinary import *and* of this file launched through a compiled output or a
 * wrapper. Comparing the paths tells those two apart, so the second can fail
 * loudly without the first ever setting an exit code on a process that merely
 * imported something from here.
 */
const entry = process.argv[1];
const selfPath = fileURLToPath(import.meta.url);
if (entry && resolve(entry) === selfPath) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else if (entry && basename(entry).startsWith("airtable-acceptance")) {
  console.error(
    `airtable-acceptance was launched as "${entry}" rather than as `
    + `${selfPath}, and did nothing. Nothing was contacted, and this run is not acceptance `
    + `evidence — run it directly: tsx scripts/airtable-acceptance.ts`,
  );
  process.exitCode = 1;
}
