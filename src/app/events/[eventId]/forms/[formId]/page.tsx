import type { Metadata } from "next";
import Link from "next/link";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/server/admin";
import { getBuilderEvent, getFormForBuilder } from "@/features/forms";
import { FormBuilder } from "@/features/forms/form-builder";
import { DEMO_EVENT_SLUG, DEMO_FORM_ID } from "@/shared/demo/seed";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { PageHeader } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Form builder" };
export default async function Page({ params }: { params: Promise<{ eventId: string; formId: string }> }) {
  const { eventId, formId } = await params;
  if (isCredentialFreeLocalDemo()) {
    return (
      <>
        <PageHeader eyebrow="PROGRAM" title="Form builder" description="Design questions, conditional logic, and routing." />
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
  const parsedFormId = formIdSchema.parse(formId);
  await requireAdmin(parsedEventId, "organizer");
  const [event, form] = await Promise.all([
    getBuilderEvent(parsedEventId),
    // Pinned to `context='cfp'` — a portal form id pasted into this URL is a
    // 404 here, not the CFP FormBuilder rendering portal-only state (mirrors
    // the guard tasks/forms/[formId]/page.tsx already pins to 'portal').
    getFormForBuilder(parsedEventId, parsedFormId, "cfp"),
  ]);
  return <FormBuilder event={event} initialForm={form} />;
}
