import type { Metadata } from "next";
import Link from "next/link";
import { eventIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/server/admin";
import { getBuilderEvent, listForms } from "@/features/forms";
import { PortalFormsPage } from "@/features/portal";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { PageHeader } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Portal Forms" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  // Form versioning needs a connected database, so the portal form builder —
  // like the CFP builder in ../../forms — is not available in the
  // credential-free local demo.
  if (isCredentialFreeLocalDemo()) {
    return (
      <>
        <PageHeader eyebrow="PEOPLE" title="Portal forms" description="Collect structured information from speakers." />
        <div className="panel settings-section">
          <h2>Portal forms need a connected database</h2>
          <p className="long-copy">
            The portal form builder is not available in the credential-free local demo.
            Onboarding tasks — including form-backed ones — can be explored from the Tasks page.
          </p>
          <Link className="button" href={`/events/${eventId}/tasks`}>Back to tasks</Link>
        </div>
      </>
    );
  }

  const parsedEventId = eventIdSchema.parse(eventId);
  await requireAdmin(parsedEventId, "organizer");
  const [event, forms] = await Promise.all([getBuilderEvent(parsedEventId), listForms(parsedEventId, "portal")]);
  return <PortalFormsPage event={event} initialForms={forms} />;
}
