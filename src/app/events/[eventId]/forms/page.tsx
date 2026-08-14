import type { Metadata } from "next";
import { eventIdSchema } from "@/shared/contracts";
import { requireAdmin } from "@/features/auth/index.server";
import { getBuilderEvent, listForms } from "@/features/forms";
import { FormsPage } from "@/features/forms/forms-page";

export const metadata: Metadata = { title: "Forms" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const parsedEventId = eventIdSchema.parse(eventId);
  await requireAdmin(parsedEventId, "organizer");
  const [event, forms] = await Promise.all([getBuilderEvent(parsedEventId), listForms(parsedEventId)]);
  return <FormsPage event={event} initialForms={forms} />;
}
