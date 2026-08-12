import type { Metadata } from "next";
import { eventIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/server/admin";
import {
  getEventTimezone,
  getTaskTabCounts,
  listFileRequests,
  listPortalForms,
  listTasks,
} from "@/features/portal/tasks-admin/server/queries";
import { TasksAdminView } from "@/features/portal/tasks-admin/components/tasks-admin-view";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  // Building the onboarding checklist is an organizer's job, same bar as the
  // form builder and evaluation rounds.
  await requireAdmin(eventId, "organizer");

  const [tasks, tabCounts, fileRequests, forms, timezone] = await Promise.all([
    listTasks(eventId),
    getTaskTabCounts(eventId),
    listFileRequests(eventId),
    listPortalForms(eventId),
    getEventTimezone(eventId),
  ]);

  return (
    <TasksAdminView
      eventId={eventId}
      timezone={timezone}
      initialTasks={tasks}
      initialTabCounts={tabCounts}
      initialFileRequests={fileRequests}
      forms={forms}
    />
  );
}
