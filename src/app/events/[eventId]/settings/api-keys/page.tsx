import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEvent } from "@/features/events";
import { listApiKeys } from "@/features/dashboard/server/api-keys";
import { ApiKeysPanel } from "@/features/dashboard/components/ApiKeysPanel";
import { PageHeader } from "@/shared/ui/ui-kit";
import { eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

/**
 * Its own route file, separate from M11's `/settings` tab shell — no
 * contention over that file. The layout above every `/events/[eventId]`
 * route has already run `requireAdmin(eventId, "organizer")` for this path,
 * so no second auth check is needed before reading.
 */
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;

  if (isCredentialFreeLocalDemo()) {
    return (
      <>
        <PageHeader eyebrow="EVENT" title="API keys" description="Bearer keys for /api/v1's keyed endpoints." />
        <div className="panel settings-section">
          <p className="long-copy">
            API keys need a real database and are not available in the credential-free local demo.
            See <code>docs/api.md</code> for the reference and the deployed preview to try it.
          </p>
        </div>
      </>
    );
  }

  const eventId = eventIdSchema.parse(rawEventId);
  const [event, keys] = await Promise.all([getEvent(eventId), listApiKeys(eventId)]);
  if (!event) notFound();

  return (
    <>
      <PageHeader eyebrow="EVENT" title="API keys" description="Bearer keys for /api/v1's keyed endpoints, scoped to this event." />
      <ApiKeysPanel eventId={eventId} initialKeys={keys} timezone={event.timezone} />
    </>
  );
}
