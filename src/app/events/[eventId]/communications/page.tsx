import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { commsKeys, getDeliverabilityByDomain, listLog, listReminderRules, listSuppressions, listTemplates } from "@/features/comms";
import { CommsAdminPage, type CommsTab } from "@/features/comms/index.client";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Communications" };
export const dynamic = "force-dynamic";

// M46 adds "suppressions"/"deliverability"/"bulk" to M37's original three tabs.
const TABS: readonly CommsTab[] = ["templates", "reminders", "log", "suppressions", "deliverability", "bulk"];

function resolveTab(value: string | undefined): CommsTab {
  return TABS.includes(value as CommsTab) ? (value as CommsTab) : "templates";
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  await requireAdmin(eventId, "organizer");

  const tab = resolveTab((await searchParams).tab);
  const [event, templates, reminderRules, log, suppressions, deliverability] = await Promise.all([
    db.select({ timezone: events.timezone }).from(events).where(eq(events.id, eventId)).limit(1),
    listTemplates(eventId),
    listReminderRules(eventId),
    listLog(eventId, { limit: 500 }),
    listSuppressions(eventId),
    getDeliverabilityByDomain(eventId),
  ]);
  const querySeeds = [
    { queryKey: commsKeys.templates(eventId), data: templates },
    { queryKey: commsKeys.reminderRules(eventId), data: reminderRules },
    { queryKey: commsKeys.log(eventId, { limit: 500 }), data: log },
    { queryKey: commsKeys.suppressions(eventId), data: suppressions },
    { queryKey: commsKeys.deliverability(eventId), data: deliverability },
  ];

  return (
    <CommsAdminPage
      eventId={eventId}
      timezone={event[0]?.timezone ?? "America/Los_Angeles"}
      initialTab={tab}
      querySeeds={querySeeds}
    />
  );
}
