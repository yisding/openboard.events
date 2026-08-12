import type { Metadata } from "next";
import { listMyTasks, requirePortalContext } from "@/features/portal";
import { TaskList } from "@/features/portal/task-runtime/components/task-list";

export const metadata: Metadata = { title: "Your tasks" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const { event, contact } = await requirePortalContext(eventSlug);
  const tasks = await listMyTasks(event.id, contact.id);

  return (
    <div className="portal-container portal-page">
      <header className="portal-page-header">
        <span className="public-eyebrow">ONBOARDING</span>
        <h1>Your tasks</h1>
        <p>Everything the event team needs from you, in one place.</p>
      </header>
      <TaskList tasks={tasks} eventSlug={event.slug} timezone={event.timezone} />
    </div>
  );
}
