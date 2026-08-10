"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmailTemplateRow, ReminderRuleRow } from "@/features/comms";
import type { CommLogRow, EventId } from "@/shared/contracts";
import { PageHeader } from "@/shared/ui/ui-kit";
import { CommsLogTable } from "./comms-log-table";
import { RemindersTab } from "./reminders-tab";
import { TabBoundary } from "./tab-boundary";
import { TemplatesTab } from "./templates-tab";

export type CommsTab = "templates" | "reminders" | "log";
const TABS: Array<{ id: CommsTab; label: string }> = [
  { id: "templates", label: "Templates" },
  { id: "reminders", label: "Reminders" },
  { id: "log", label: "Log" },
];

/**
 * `/events/[eventId]/communications` — the comms admin page's three tabs
 * (step 2). `?tab=` is the source of truth so every tab deep-links; each
 * panel's initial data was hydrated server-side as TanStack `initialData`
 * (the page RSC fetched all three), and a broken panel hides itself rather
 * than white-screening its siblings (`<TabBoundary>`, step 8).
 */
export function CommsAdminPage({
  eventId,
  timezone,
  initialTab,
  initialTemplates,
  initialReminderRules,
  initialLog,
}: {
  eventId: EventId;
  timezone: string;
  initialTab: CommsTab;
  initialTemplates: EmailTemplateRow[];
  initialReminderRules: ReminderRuleRow[];
  initialLog: CommLogRow[];
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
        <PageHeader eyebrow="ENGAGE" title="Communications" description="Templates, the reminder ladder, and a complete delivery log." />
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
      </main>
    </QueryClientProvider>
  );
}
