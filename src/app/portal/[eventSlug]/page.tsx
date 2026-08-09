import type { Metadata } from "next";
import { getMyTaskSummary, listMySubmissions, requirePortalContext } from "@/features/portal";
import { PortalHomeWidgets } from "@/features/portal/components/home/portal-home-widgets";
import { PortalHome } from "@/features/portal/portal-home";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Speaker portal" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  // The credential-free demo has no database to read; everywhere else this is
  // the speaker's own data.
  if (isCredentialFreeLocalDemo()) return <PortalHome />;

  const { event, contact } = await requirePortalContext(eventSlug);
  const [submissions, tasks] = await Promise.all([
    listMySubmissions(event.id, contact.id),
    getMyTaskSummary(event.id, contact.id),
  ]);
  return (
    <PortalHomeWidgets
      firstName={contact.firstName}
      eventSlug={event.slug}
      timezone={event.timezone}
      submissions={submissions}
      tasks={tasks}
    />
  );
}
