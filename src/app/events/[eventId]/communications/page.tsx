import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { getDeliverabilityByDomain, listLog, listReminderRules, listSuppressions, listTemplates } from "@/features/comms";
import { CommunicationsPage } from "@/features/comms/communications-page";
import { CommsAdminPage, type CommsTab } from "@/features/comms/index.client";
import { eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

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
  // The credential-free demo has no database to read; everywhere else this is
  // the event's real templates, reminder ladder and comms log.
  if (isCredentialFreeLocalDemo()) return <CommunicationsPage />;

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

  return (
    <CommsAdminPage
      eventId={eventId}
      timezone={event[0]?.timezone ?? "America/Los_Angeles"}
      initialTab={tab}
      initialTemplates={templates}
      initialReminderRules={reminderRules}
      initialLog={log}
      initialSuppressions={suppressions}
      initialDeliverability={deliverability}
    />
  );
}
