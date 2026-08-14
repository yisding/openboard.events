import type { Metadata } from "next";
import { requireAdmin } from "@/features/auth/index.server";
import { getBuilderEvent, getFormForBuilder } from "@/features/forms";
import { OrganizerFormPreview } from "@/features/forms/components/builder/organizer-form-preview";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Preview form" };

export default async function Page({ params }: { params: Promise<{ eventId: string; formId: string }> }) {
  const { eventId, formId } = await params;
  const parsedEventId = eventIdSchema.parse(eventId);
  const parsedFormId = formIdSchema.parse(formId);
  await requireAdmin(parsedEventId, "organizer");
  const [event, form] = await Promise.all([
    getBuilderEvent(parsedEventId),
    getFormForBuilder(parsedEventId, parsedFormId, "cfp"),
  ]);
  return <OrganizerFormPreview event={event} form={form} nowIso={new Date().toISOString()} />;
}
