import type { Metadata } from "next";
import { eventIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/index.server";
import { getBuilderEvent, listForms } from "@/features/forms";
import { PortalFormsPage } from "@/features/portal";

export const metadata: Metadata = { title: "Portal Forms" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const parsedEventId = eventIdSchema.parse(eventId);
  await requireAdmin(parsedEventId, "organizer");
  const [event, forms] = await Promise.all([getBuilderEvent(parsedEventId), listForms(parsedEventId, "portal")]);
  return <PortalFormsPage event={event} initialForms={forms} />;
}
