import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getEvent } from "@/features/events";
import { listApiKeys } from "@/features/dashboard/server/api-keys";
import { ApiKeysPanel } from "@/features/dashboard/components/ApiKeysPanel";
import { PageHeader } from "@/shared/ui/ui-kit";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

/**
 * Its own route file, separate from M11's `/settings` tab shell — no
 * contention over that file.
 */
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;

  const eventId = eventIdSchema.parse(rawEventId);
  // The layout runs the same guard, but it does not re-run on a client-side
  // navigation between sibling segments, so the page holds the bar itself
  // before it reads any key metadata.
  await requireAdmin(eventId, "organizer");
  const [event, keys] = await Promise.all([getEvent(eventId), listApiKeys(eventId)]);
  if (!event) notFound();

  return (
    <>
      <PageHeader eyebrow="EVENT" title="API keys" description="Bearer keys for /api/v1's keyed endpoints, scoped to this event." />
      <ApiKeysPanel eventId={eventId} initialKeys={keys} timezone={event.timezone} />
    </>
  );
}
