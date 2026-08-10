import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { withTx } from "@/db/client";
import { events, resourcePages } from "@/db/schema";
import { SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID, type SeedCtx, type SeedModule } from "./lib/helpers";
import { seedId } from "./lib/ids";
import { assertSafeSeedTarget } from "./lib/safety";

type ResourcePageSeed = {
  key: string;
  title: string;
  slug: string;
  summary: string;
  published: boolean;
  sortOrder: number;
  bodyHtml: string;
};

/**
 * `portal.ts` (M21, runs earlier in the same transaction) seeded two resource
 * pages of its own — `speaker-handbook` and `presentation-guidelines` — back
 * when no module owned this table. Their content is a strict subset of the
 * probes below (an allowlisted YouTube iframe, a `<script>` payload), so
 * leaving them in place only puts five near-duplicate pages in front of the
 * CP3 "resources page with iframe embed" demo. This module owns the seeded
 * resource set, so it retires them by their deterministic seed ids — never by
 * slug or by a blanket delete, which would take out rows an operator added by
 * hand on a demo database.
 */
const RETIRED_KEYS = ["speaker-handbook", "presentation-guidelines"] as const;

/**
 * Three probes in one array: a normal published page, a published page
 * carrying both an allowlisted YouTube iframe and two XSS payloads
 * (`<script>` and an `onerror` handler), and an unpublished page that must
 * never reach the portal. The work order's own AC curl checks read straight
 * off these slugs (`speaker-guide`, `venue-travel`, `internal-notes`).
 */
const PAGES: readonly ResourcePageSeed[] = [
  {
    key: "speaker-guide",
    title: "Speaker Guide",
    slug: "speaker-guide",
    summary: "Arrival, check-in, stage logistics and what to expect from the production team.",
    published: true,
    sortOrder: 10,
    bodyHtml: "<h2>Before you arrive</h2><p>Everything you need to know before stepping on stage.</p>"
      + "<ul><li>Arrive 45 minutes before your session</li><li>Bring a backup of your slides</li><li>Mic check happens at the AV desk</li></ul>"
      + '<p>Questions? <a href="mailto:speakers@openboard.dev">Email the speaker team</a>.</p>',
  },
  {
    key: "venue-travel",
    title: "Venue & Travel",
    slug: "venue-travel",
    summary: "A walkthrough of the venue and the stage, plus how to get there.",
    published: true,
    sortOrder: 20,
    bodyHtml: "<h2>Getting there</h2><p>A short walkthrough of the venue and stage before you fly in.</p>"
      + '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Venue walkthrough" width="560" height="315" allowfullscreen></iframe>'
      + "<script>alert(1)</script>"
      + '<img src="x" onerror="alert(1)">',
  },
  {
    key: "internal-notes",
    title: "Internal Notes",
    slug: "internal-notes",
    summary: "Run-of-show risk notes for the organizing team.",
    published: false,
    sortOrder: 30,
    bodyHtml: "<h2>Internal only</h2><p>Run-of-show risk notes for the organizing team. Never publish this one.</p>",
  },
];

/**
 * Orchestrator entry point (`scripts/seed/index.ts`'s `MODULES` array). Raw
 * fixture rows, not run through `saveResourcePageIn` — the whole point of the
 * `<script>`/`onerror` probes is to prove the **render**-side sanitizer
 * (`<RichTextView wide>`) strips what a save-time sanitizer never got a
 * chance to see, since this seed bypasses the mutation layer entirely.
 */
export const seedResources: SeedModule = async (ctx) => {
  const { tx, eventId } = ctx;
  // events.ts owns the event row. Without it every insert here fails its
  // foreign key, which would take the whole run down for a module that has
  // not run yet — the same degrade-to-skip `portal.ts` uses.
  const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    ctx.log("skipped — the event does not exist yet (events.ts)");
    return;
  }

  for (const page of PAGES) {
    await tx.insert(resourcePages).values({
      id: ctx.id("resource", page.key),
      eventId,
      title: page.title,
      slug: page.slug,
      summary: page.summary,
      bodyHtml: page.bodyHtml,
      published: page.published,
      sortOrder: page.sortOrder,
    }).onConflictDoUpdate({
      target: resourcePages.id,
      set: { title: page.title, slug: page.slug, summary: page.summary, bodyHtml: page.bodyHtml, published: page.published, sortOrder: page.sortOrder, updatedAt: new Date() },
    });
  }

  // Retire the earlier portal.ts fixtures (see RETIRED_KEYS). Scoped to both
  // the event and the exact deterministic ids, so a re-run is a no-op and a
  // hand-authored page with the same slug is never touched.
  const retiredIds = RETIRED_KEYS.map((key) => ctx.id("resource", key));
  const retired = await tx
    .delete(resourcePages)
    .where(and(eq(resourcePages.eventId, eventId), inArray(resourcePages.id, retiredIds)))
    .returning({ id: resourcePages.id });

  ctx.log(`seeded ${PAGES.length} resource pages (1 unpublished, 1 carrying the sanitizer probes)`
    + `${retired.length > 0 ? `, retired ${retired.length} duplicate portal.ts page(s)` : ""}`);
};

// tsx transforms this to CJS, where top-level await is not available (same
// note as `scripts/seed/index.ts`), so the standalone run lives in main().
async function main(): Promise<void> {
  assertSafeSeedTarget(process.env);
  const now = new Date();
  await withTx(async (tx) => {
    const ctx: SeedCtx = {
      tx,
      now,
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: (msg: string) => console.log(`  resources: ${msg}`),
    };
    await seedResources(ctx);
  });
  console.log("resources seed complete");
}

// Runs only when this file is invoked directly (`pnpm tsx scripts/seed/resources.ts`),
// never when `scripts/seed/index.ts` imports `seedResources` into its own transaction.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
