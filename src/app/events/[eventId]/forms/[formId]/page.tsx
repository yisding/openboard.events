import type { Metadata } from "next";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/server/admin";
import { getBuilderEvent, getFormForBuilder } from "@/features/forms";
import { FormBuilder } from "@/features/forms/form-builder";

export const metadata: Metadata = { title: "Form builder" };
export default async function Page({ params }: { params: Promise<{ eventId: string; formId: string }> }) {
  const { eventId, formId } = await params;
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
