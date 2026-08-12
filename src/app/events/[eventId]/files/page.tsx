import type { Metadata } from "next";
import { requireAdmin } from "@/features/auth/server/admin";
import { getDeliverableStateCounts, listDeliverables, parseDeliverableFiltersForPage, type DeliverableFilters } from "@/features/portal/deliverables";
import { listFileRequests, listTasks } from "@/features/portal/tasks-admin/server/queries";
import { FilesAdminView } from "@/features/portal/deliverables/components/files-admin-view";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Files" };
export const dynamic = "force-dynamic";

/**
 * M52 — the central Files view: every file-request deliverable across the
 * event. Filters live in the URL and the row set comes back already narrowed
 * from the database, the same discipline the Abstracts view's server-aware
 * filtering keeps — a bounded event's worth of deliverables was never a
 * reason to ship the whole table to the browser and filter it there.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  await requireAdmin(eventId, "organizer");

  const filters = parseDeliverableFiltersForPage(await searchParams);
  const hasUpload = filters.hasUpload === "true" ? true : filters.hasUpload === "false" ? false : undefined;
  const dtoFilters: DeliverableFilters = {
    ...(filters.taskId ? { taskId: filters.taskId } : {}),
    ...(filters.fileRequestId ? { fileRequestId: filters.fileRequestId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.state !== "all" ? { state: filters.state } : {}),
    ...(hasUpload !== undefined ? { hasUpload } : {}),
    ...(filters.search ? { search: filters.search } : {}),
  };
  // Same filters as the table minus `state` — what keeps the tab badges honest
  // about an active search without letting the active tab hide the others.
  const countsFilters: Omit<DeliverableFilters, "state"> = {
    ...(filters.taskId ? { taskId: filters.taskId } : {}),
    ...(filters.fileRequestId ? { fileRequestId: filters.fileRequestId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(hasUpload !== undefined ? { hasUpload } : {}),
    ...(filters.search ? { search: filters.search } : {}),
  };

  const [rows, counts, fileRequests, tasks] = await Promise.all([
    listDeliverables(eventId, dtoFilters),
    getDeliverableStateCounts(eventId, countsFilters),
    listFileRequests(eventId),
    listTasks(eventId),
  ]);
  const fileTasks = tasks.filter((task) => task.completionMode === "file_request");

  return (
    <FilesAdminView
      eventId={eventId}
      rows={rows}
      counts={counts}
      state={filters.state}
      taskId={filters.taskId ?? ""}
      fileRequestId={filters.fileRequestId ?? ""}
      hasUpload={filters.hasUpload === "true" ? "yes" : filters.hasUpload === "false" ? "no" : ""}
      search={filters.search}
      fileRequests={fileRequests.map((request) => ({ id: request.id, title: request.title }))}
      tasks={fileTasks.map((task) => ({ id: task.id, name: task.name }))}
    />
  );
}
