import type { Metadata } from "next";
import { getAdminSession, listAdminSessions } from "@/features/auth";
import { SessionsPanel } from "@/features/auth/components/sessions-panel";
import { PageHeader } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Sessions" };
export const dynamic = "force-dynamic";

export default async function Page() {
  // The layout above already required a session to exist; this reads it
  // again for the user id rather than threading it through, matching
  // `events/[eventId]/settings/page.tsx`'s "layout already checked" comment.
  const identity = await getAdminSession();
  const sessions = identity ? await listAdminSessions(identity.userId) : [];
  return <>
    <PageHeader eyebrow="ACCOUNT" title="Sessions" description="Devices currently signed in as you, and the ability to sign any of them out." />
    <SessionsPanel initialSessions={sessions} />
  </>;
}
