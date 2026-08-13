import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { listSpeakerOptions } from "@/features/portal";
import { AbstractsView } from "@/features/submissions/components/abstracts-view";
import { getStatusCounts, getSubmissionVocabulary, listSubmissions, parseSubmissionFiltersForPage } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Abstracts" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  // This payload carries submitter identity and the speaker option list, so it
  // is organizer-only — the same bar `/api/internal/submissions` holds a
  // reviewer to. The role is repeated here rather than left to the layout
  // because a client-side navigation between sibling segments re-renders the
  // page without re-running the layout's guard. Reviewers read submissions
  // through `/review`, which redacts identity for a blind round.
  const session = await requireAdmin(eventId, "organizer");
  const canEdit = session.role === "owner" || session.role === "organizer";

  // Read through the page reader, which keeps a hand-edited or stale query
  // string from 500ing the whole surface. The hand-rolled `Number(page)` this
  // replaces was also the reason the paging bug hid: the page coerced by hand
  // and worked, while the API route it shares the schema with rejected the same
  // value, so `?pageSize=200` was a 400 nobody saw in a browser.
  const filters = parseSubmissionFiltersForPage(await searchParams);

  const [event] = await db
    .select({ timezone: events.timezone })
    .from(events)
    .where(and(eq(events.id, eventId)))
    .limit(1);

  // Rows and counts come from the same filters, which is what keeps the tab
  // numbers honest about the table under them.
  const [list, counts, unfiltered, vocabulary, speakers] = await Promise.all([
    listSubmissions(eventId, filters),
    getStatusCounts(eventId, { search: filters.search, trackId: filters.trackId, tagId: filters.tagId, pageSize: filters.pageSize, sort: filters.sort }),
    // Notify finalizes both queues for the whole event, so the number on its
    // button has to be the whole event's — a search must not make it look like
    // fewer speakers are about to be emailed than actually are.
    getStatusCounts(eventId, { search: "", trackId: null, tagId: null, pageSize: filters.pageSize, sort: filters.sort }),
    getSubmissionVocabulary(eventId),
    // Add abstract attributes the talk to a person (#117); this is the same
    // list the agenda's session dialog picks from.
    listSpeakerOptions(eventId),
  ]);

  return (
    <AbstractsView
      eventId={eventId}
      rows={list.rows}
      counts={counts}
      status={filters.status}
      search={filters.search}
      total={unfiltered.all}
      filteredTotal={list.total}
      page={list.page}
      pageSize={list.pageSize}
      sort={filters.sort}
      queued={unfiltered.accept_queue + unfiltered.decline_queue}
      timezone={event?.timezone ?? "America/Los_Angeles"}
      vocabulary={vocabulary}
      speakers={speakers}
      canEdit={canEdit}
    />
  );
}
