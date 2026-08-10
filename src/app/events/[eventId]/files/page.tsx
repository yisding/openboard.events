import type { Metadata } from "next";
import { requireAdmin } from "@/features/auth/server/admin";
import { listDeliverables } from "@/features/portal/deliverables";
import { listFileRequests, listTasks } from "@/features/portal/tasks-admin/server/queries";
import { FilesAdminView } from "@/features/portal/deliverables/components/files-admin-view";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Files" };
export const dynamic = "force-dynamic";

/** M52 — the central Files view: every file-request deliverable across the event. */
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  await requireAdmin(eventId, "organizer");

  const [rows, fileRequests, tasks] = await Promise.all([
    listDeliverables(eventId),
    listFileRequests(eventId),
    listTasks(eventId),
  ]);
  const fileTasks = tasks.filter((task) => task.completionMode === "file_request");

  return (
    <FilesAdminView
      eventId={eventId}
      initialRows={rows}
      fileRequests={fileRequests.map((request) => ({ id: request.id, title: request.title }))}
      tasks={fileTasks.map((task) => ({ id: task.id, name: task.name }))}
    />
  );
}
