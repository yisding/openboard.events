import type { Metadata } from "next";
import { getMySessions } from "@/features/agenda";
import { getMyTaskSummary, listMySubmissions, listMyTasks, markAcceptanceSeen, requirePortalContext } from "@/features/portal";
import { signSpeakerShareToken } from "@/features/portal/server/share";
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
  const [submissions, tasks, myTasks, mySessions] = await Promise.all([
    listMySubmissions(event.id, contact.id),
    getMyTaskSummary(event.id, contact.id),
    listMyTasks(event.id, contact.id),
    getMySessions(event.id, contact.id),
  ]);

  // M59 — the acceptance celebration fires once. This request is the one
  // that decides to show it, so this request is also the one that marks it
  // seen — awaited, not fire-and-forget, so a second tab opened a moment
  // later already sees the ordinary home rather than a race.
  const showCelebration = submissions.some((row) => row.status === "Accepted") && contact.acceptanceSeenAt === null;
  if (showCelebration) await markAcceptanceSeen(event.id, contact.id);

  let shareUrl: string | null = null;
  if (submissions.some((row) => row.status === "Accepted")) {
    try {
      const token = await signSpeakerShareToken({ eventId: event.id, contactId: contact.id });
      shareUrl = `/speaking/${token}`;
    } catch {
      // SPEAKER_SHARE_SECRET is not provisioned in every environment yet
      // (see the env schema's comment) — the celebration and hero still
      // render, just without the share CTA, rather than 500ing the home.
      shareUrl = null;
    }
  }

  return (
    <PortalHomeWidgets
      firstName={contact.firstName}
      eventId={event.id}
      eventSlug={event.slug}
      eventName={event.name}
      timezone={event.timezone}
      submissions={submissions}
      tasks={tasks}
      myTasks={myTasks}
      mySessions={mySessions}
      showCelebration={showCelebration}
      shareUrl={shareUrl}
    />
  );
}
