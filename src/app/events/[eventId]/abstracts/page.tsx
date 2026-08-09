import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { AbstractsPage } from "@/features/submissions/abstracts-page";
import { AbstractsView } from "@/features/submissions/components/abstracts-view";
import { getStatusCounts, listSubmissions, submissionFiltersSchema } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

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
  // The credential-free demo has no database to read; everywhere else this is
  // the event's real submissions.
  if (isCredentialFreeLocalDemo()) return <AbstractsPage eventId={rawEventId} />;

  const eventId = eventIdSchema.parse(rawEventId);
  // Any member may read the submissions they are reviewing, so no role is
  // required here — the layout's guard has already established membership.
  await requireAdmin(eventId);

  const query = await searchParams;
  const filters = submissionFiltersSchema.parse({
    ...(typeof query.status === "string" ? { status: query.status } : {}),
    ...(typeof query.search === "string" ? { search: query.search } : {}),
    ...(typeof query.page === "string" ? { page: Number(query.page) } : {}),
  });

  const [event] = await db
    .select({ timezone: events.timezone })
    .from(events)
    .where(and(eq(events.id, eventId)))
    .limit(1);

  // Rows and counts come from the same filters, which is what keeps the tab
  // numbers honest about the table under them.
  const [list, counts] = await Promise.all([
    listSubmissions(eventId, filters),
    getStatusCounts(eventId, { search: filters.search, trackId: filters.trackId, tagId: filters.tagId, pageSize: filters.pageSize, sort: filters.sort }),
  ]);

  return (
    <AbstractsView
      rows={list.rows}
      counts={counts}
      status={filters.status}
      search={filters.search}
      total={counts.all}
      timezone={event?.timezone ?? "America/Los_Angeles"}
    />
  );
}
