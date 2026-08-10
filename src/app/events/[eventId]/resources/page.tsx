import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth/server/admin";
import { listResourcePages } from "@/features/portal/resources";
import { ResourcePagesAdminView } from "@/features/portal/resources/components/resource-pages-admin-view";
import { ResourcesAdminPage } from "@/features/portal/resources-admin-page";
import { eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Resources" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  // The credential-free demo has no database to read; everywhere else this is
  // the event's real resource pages, database-backed CRUD and all.
  if (isCredentialFreeLocalDemo()) return <ResourcesAdminPage eventId={rawEventId} />;

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
