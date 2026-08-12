import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { listOrganizationEvents } from "@/features/organizations";
import { getCrmMetrics, listCrmTags, listOrganizationContacts } from "@/features/crm";
import { DirectoryView } from "@/features/crm/components/directory-view";
import { directoryFilterSchema, CRM_CONTACT_SOURCES, CRM_PIPELINE_STAGES, organizationIdSchema, type CrmContactSource, type CrmPipelineStage } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Speaker CRM" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * M55 — the organization directory (work order: "org-level directory:
 * list/search/segments"). Filters live in the URL exactly like
 * `/events/[eventId]/speakers` does one scope down: this server component
 * re-reads `searchParams`, re-runs `listOrganizationContacts`, and hands the
 * page to `DirectoryView` — no client-side data fetching for the list itself.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;

  try {
    await requireOrganizationAdmin(organizationId);
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    notFound();
  }

  const query = await searchParams;
  const search = firstOf(query.search) ?? "";
  const tagIds = (firstOf(query.tagIds) ?? "").split(",").filter(Boolean);
  const eventId = firstOf(query.eventIds) ?? null;
  const pipelineStageParam = firstOf(query.pipelineStage);
  const pipelineStage: CrmPipelineStage | null = (CRM_PIPELINE_STAGES as readonly string[]).includes(pipelineStageParam ?? "") ? pipelineStageParam as CrmPipelineStage : null;
  const sourceParam = firstOf(query.source);
  const source: CrmContactSource | null = (CRM_CONTACT_SOURCES as readonly string[]).includes(sourceParam ?? "") ? sourceParam as CrmContactSource : null;
  const hasEventLink = firstOf(query.hasEventLink) === "false" ? false : firstOf(query.hasEventLink) === "true" ? true : null;
  const pageParam = Number(firstOf(query.page) ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  // `safeParse` rather than `parse`: a hand-edited or stale URL (a tag/event
  // id that no longer exists, or was never a real id) must degrade to the
  // unfiltered directory, not a crashed page — the same tolerance the query
  // string itself already gets from `firstOf`/the pipeline-stage allowlist
  // above.
  const parsedFilter = directoryFilterSchema.safeParse({
    search: search || undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    eventIds: eventId ? [eventId] : undefined,
    pipelineStage: pipelineStage ? [pipelineStage] : undefined,
    source: source ? [source] : undefined,
    hasEventLink: hasEventLink ?? undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const filter = parsedFilter.success ? parsedFilter.data : directoryFilterSchema.parse({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  const [{ rows, total }, tags, events, metrics] = await Promise.all([
    listOrganizationContacts(organizationId, filter),
    listCrmTags(organizationId),
    listOrganizationEvents(organizationId),
    getCrmMetrics(organizationId),
  ]);

  return (
    <DirectoryView
      organizationId={organizationId}
      rows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      search={search}
      tagIds={tagIds}
      pipelineStage={pipelineStage}
      source={source}
      hasEventLink={hasEventLink}
      eventId={eventId}
      tags={tags}
      events={events}
      metrics={metrics}
    />
  );
}
