import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth/index.server";
import { listResourcePages } from "@/features/portal/resources";
import { ResourcePagesAdminView } from "@/features/portal/resources/components/resource-pages-admin-view";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Resources" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  // Authoring the speaker handbook is an organizer's job, same bar as the
  // form builder, tasks and evaluation rounds.
  await requireAdmin(eventId, "organizer");

  const [[event], pages] = await Promise.all([
    db.select({ slug: events.slug, timezone: events.timezone }).from(events).where(eq(events.id, eventId)).limit(1),
    listResourcePages(eventId),
  ]);

  return (
    <ResourcePagesAdminView
      eventId={eventId}
      eventSlug={event?.slug ?? ""}
      timezone={event?.timezone ?? "America/Los_Angeles"}
      initialPages={pages}
    />
  );
}
