import type { Metadata } from "next";
import { listMySubmissions, requirePortalContext } from "@/features/portal";
import { SubmissionList } from "@/features/portal/components/submissions-view/submission-list";
import { PortalSubmissions } from "@/features/portal/portal-submissions";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "My submissions" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  // The credential-free demo has no database to read; it keeps the browser
  // fixture path the README promises. Everywhere else this is real data.
  if (isCredentialFreeLocalDemo()) return <PortalSubmissions />;

  const { event, contact } = await requirePortalContext(eventSlug);
  const rows = await listMySubmissions(event.id, contact.id);
  return (
    <div className="portal-container portal-page">
      <header className="portal-page-header">
        <span className="public-eyebrow">MY PROGRAM</span>
        <h1>My submissions</h1>
        <p>Every proposal you are on, with its current status.</p>
      </header>
      <SubmissionList rows={rows} eventSlug={event.slug} timezone={event.timezone} />
    </div>
  );
}
