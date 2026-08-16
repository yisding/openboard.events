import { createResourcePageIn } from "@/features/portal";
import { RESOURCE_PAGES } from "../dataset";
import { demoId } from "../ids";
import type { PhaseCtx } from "./context";

/**
 * Phase 9 — the speaker handbook, Q5's whole payload.
 *
 * Three pages, one still unpublished — a resource page an organizer is
 * visibly still drafting is more honest than three that are all done, and it
 * gives the resources list something to look like mid-conference rather than
 * finished.
 *
 * `createResourcePageIn` is idempotent on a supplied `id`: the first call
 * inserts, every replay finds the row it already made and returns it
 * untouched, so re-running this phase never re-slugs or re-sorts a page an
 * organizer may have since edited by hand.
 */
export async function runResourcesPhase(ctx: PhaseCtx): Promise<void> {
  const { dbOrTx, eventId } = ctx;
  for (const page of RESOURCE_PAGES) {
    await createResourcePageIn(dbOrTx, eventId, {
      id: demoId(eventId, `resource-page:${page.key}`),
      title: page.title,
      slug: page.slug,
      bodyHtml: page.bodyHtml,
      published: page.published,
    });
  }
}
