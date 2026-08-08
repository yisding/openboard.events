import type { Metadata } from "next";
import { TasksAdminPage } from "@/features/portal/tasks-admin-page";

export const metadata: Metadata = { title: "Tasks" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <TasksAdminPage eventId={eventId} />;
}
