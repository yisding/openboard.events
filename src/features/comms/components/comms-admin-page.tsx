"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DomainDeliverabilityRow, EmailTemplateRow, ReminderRuleRow, SuppressionRow } from "@/features/comms";
import type { CommLogRow, EventId } from "@/shared/contracts";
import { PageHeader } from "@/shared/ui/ui-kit";
import { BulkSendTab } from "./bulk-send-tab";
import { CommsLogTable } from "./comms-log-table";
import { DeliverabilityTab } from "./deliverability-tab";
import { RemindersTab } from "./reminders-tab";
import { SuppressionsTab } from "./suppressions-tab";
import { TabBoundary } from "./tab-boundary";
import { TemplatesTab } from "./templates-tab";

// M46 adds three tabs — Suppressions, Deliverability, Bulk send — to M37's
// original three, over the same `?tab=` URL-synced shell.
export type CommsTab = "templates" | "reminders" | "log" | "suppressions" | "deliverability" | "bulk";
const TABS: Array<{ id: CommsTab; label: string }> = [
  { id: "templates", label: "Templates" },
  { id: "reminders", label: "Reminders" },
  { id: "log", label: "Log" },
  { id: "suppressions", label: "Suppressions" },
  { id: "deliverability", label: "Deliverability" },
  { id: "bulk", label: "Bulk send" },
];

/**
 * `/events/[eventId]/communications` — the comms admin page's six tabs:
 * M37's original three (Templates, Reminders, Log) plus M46's compliance and
 * deliverability ops (Suppressions, Deliverability, Bulk send). `?tab=` is
 * the source of truth so every tab deep-links; each panel's initial data was
 * hydrated server-side as TanStack `initialData` (the page RSC fetched all
 * five reads up front), and a broken panel hides itself rather than
 * white-screening its siblings (`<TabBoundary>`, M37 step 8).
 */
export function CommsAdminPage({
  eventId,
  timezone,
  initialTab,
  initialTemplates,
  initialReminderRules,
  initialLog,
  initialSuppressions,
  initialDeliverability,
}: {
  eventId: EventId;
  timezone: string;
  initialTab: CommsTab;
  initialTemplates: EmailTemplateRow[];
  initialReminderRules: ReminderRuleRow[];
  initialLog: CommLogRow[];
  initialSuppressions: SuppressionRow[];
  initialDeliverability: DomainDeliverabilityRow[];
}) {
  const [client] = useState(() => new QueryClient());
  const router = useRouter();
  const [tab, setTab] = useState<CommsTab>(initialTab);

  function selectTab(next: CommsTab) {
    setTab(next);
    router.replace(`/events/${eventId}/communications?tab=${next}`, { scroll: false });
  }

  return (
    <QueryClientProvider client={client}>
      <main className="page">
        <PageHeader eyebrow="ENGAGE" title="Communications" description="Templates, the reminder ladder, delivery log, suppression list, deliverability, and bulk sends." />
        <div className="communications-tabs" role="tablist" aria-label="Communications sections">
          {TABS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? "active" : ""} onClick={() => selectTab(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        {tab === "templates" && (
          <TabBoundary name="templates">
            <TemplatesTab eventId={eventId} initialData={initialTemplates} />
          </TabBoundary>
        )}
        {tab === "reminders" && (
          <TabBoundary name="reminders">
            <RemindersTab eventId={eventId} initialData={initialReminderRules} />
          </TabBoundary>
        )}
        {tab === "log" && (
          <TabBoundary name="log">
            <CommsLogTable eventId={eventId} timezone={timezone} initialData={initialLog} />
          </TabBoundary>
        )}
        {tab === "suppressions" && (
          <TabBoundary name="suppressions">
            <SuppressionsTab eventId={eventId} timezone={timezone} initialData={initialSuppressions} />
          </TabBoundary>
        )}
        {tab === "deliverability" && (
          <TabBoundary name="deliverability">
            <DeliverabilityTab eventId={eventId} initialData={initialDeliverability} />
          </TabBoundary>
        )}
        {tab === "bulk" && (
          <TabBoundary name="bulk">
            <BulkSendTab eventId={eventId} />
          </TabBoundary>
        )}
      </main>
    </QueryClientProvider>
  );
}
