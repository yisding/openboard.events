import type { Metadata } from "next";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/index.server";
import { getBuilderEvent, getFormForBuilder } from "@/features/forms";
import { PortalFormBuilder } from "@/features/portal";

export const metadata: Metadata = { title: "Portal form builder" };
export default async function Page({ params }: { params: Promise<{ eventId: string; formId: string }> }) {
  const { eventId, formId } = await params;
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
