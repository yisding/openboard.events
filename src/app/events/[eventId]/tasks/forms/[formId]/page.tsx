import type { Metadata } from "next";
import Link from "next/link";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/server/admin";
import { getBuilderEvent, getFormForBuilder } from "@/features/forms";
import { PortalFormBuilder } from "@/features/portal";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { PageHeader } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Portal form builder" };
export default async function Page({ params }: { params: Promise<{ eventId: string; formId: string }> }) {
  const { eventId, formId } = await params;
  // Form versioning needs a connected database, so the portal form builder —
  // like the CFP builder in ../../../forms — is not available in the
  // credential-free local demo.
  if (isCredentialFreeLocalDemo()) {
    return (
      <>
        <PageHeader eyebrow="PEOPLE" title="Portal form builder" description="Design questions for speaker onboarding forms." />
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
  const parsedFormId = formIdSchema.parse(formId);
  await requireAdmin(parsedEventId, "organizer");
  const [event, form] = await Promise.all([
    getBuilderEvent(parsedEventId),
    // Pinned to `context='portal'` — a CFP form id pasted into this URL is a
    // 404 here, not a portal builder rendering CFP-only state (M24 §6).
    getFormForBuilder(parsedEventId, parsedFormId, "portal"),
  ]);
  return <PortalFormBuilder event={event} initialForm={form} />;
}
