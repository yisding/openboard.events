import type { Metadata } from "next";
import Link from "next/link";
import { eventIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/server/admin";
import { getBuilderEvent, listForms } from "@/features/forms";
import { FormsPage } from "@/features/forms/forms-page";
import { DEMO_EVENT_SLUG, DEMO_FORM_ID } from "@/shared/demo/seed";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { PageHeader } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Forms" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (isCredentialFreeLocalDemo()) {
    return (
      <>
        <PageHeader eyebrow="PROGRAM" title="Forms" description="Create and publish calls for proposals." />
        <div className="panel settings-section">
          <h2>Explore the live call for proposals</h2>
          <p className="long-copy">
            Form versioning needs a connected database, so the builder is not available in the credential-free local demo.
            The published fixture form includes conditional fields, validation, and the complete submission flow.
          </p>
          <Link className="button" href={`/submit/${DEMO_EVENT_SLUG}/${DEMO_FORM_ID}`}>Open proposal form</Link>
        </div>
      </>
    );
  }

  const parsedEventId = eventIdSchema.parse(eventId);
  await requireAdmin(parsedEventId, "organizer");
  const [event, forms] = await Promise.all([getBuilderEvent(parsedEventId), listForms(parsedEventId)]);
  return <FormsPage event={event} initialForms={forms} />;
}
