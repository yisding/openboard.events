"use client";

import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, BellRing, FileText, History, Send, ShieldOff } from "lucide-react";
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
const TABS: Array<{ id: CommsTab; label: string; icon: typeof FileText }> = [
  { id: "templates", label: "Templates", icon: FileText },
  { id: "reminders", label: "Reminders", icon: BellRing },
  { id: "log", label: "Delivery log", icon: History },
  { id: "suppressions", label: "Suppressions", icon: ShieldOff },
  { id: "deliverability", label: "Deliverability", icon: Activity },
  { id: "bulk", label: "Bulk send", icon: Send },
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

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: CommsTab) {
    const currentIndex = TABS.findIndex((entry) => entry.id === current);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % TABS.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + TABS.length) % TABS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? TABS.length - 1
            : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TABS[nextIndex]?.id;
    if (!next) return;
    selectTab(next);
    requestAnimationFrame(() => document.getElementById(`communications-tab-${next}`)?.focus());
  }

  return (
    <QueryClientProvider client={client}>
      <main className="page">
        <PageHeader eyebrow="ENGAGE" title="Communications" description="Design messages, automate reminders, and understand what reached your audience." />
        <div className="communications-tabs" role="tablist" aria-label="Communications sections">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                id={`communications-tab-${entry.id}`}
                type="button"
                role="tab"
                aria-controls={`communications-panel-${entry.id}`}
                aria-selected={tab === entry.id}
                tabIndex={tab === entry.id ? 0 : -1}
                className={tab === entry.id ? "active" : ""}
                onKeyDown={(event) => moveTab(event, entry.id)}
                onClick={() => selectTab(entry.id)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{entry.label}</span>
              </button>
            );
          })}
        </div>
        {tab === "templates" && (
          <div className="communications-panel" id="communications-panel-templates" role="tabpanel" aria-labelledby="communications-tab-templates">
            <TabBoundary name="templates">
              <TemplatesTab eventId={eventId} initialData={initialTemplates} />
            </TabBoundary>
          </div>
        )}
        {tab === "reminders" && (
          <div className="communications-panel" id="communications-panel-reminders" role="tabpanel" aria-labelledby="communications-tab-reminders">
            <TabBoundary name="reminders">
              <RemindersTab eventId={eventId} initialData={initialReminderRules} />
            </TabBoundary>
          </div>
        )}
        {tab === "log" && (
          <div className="communications-panel" id="communications-panel-log" role="tabpanel" aria-labelledby="communications-tab-log">
            <TabBoundary name="log">
              <CommsLogTable eventId={eventId} timezone={timezone} initialData={initialLog} />
            </TabBoundary>
          </div>
        )}
        {tab === "suppressions" && (
          <div className="communications-panel" id="communications-panel-suppressions" role="tabpanel" aria-labelledby="communications-tab-suppressions">
            <TabBoundary name="suppressions">
              <SuppressionsTab eventId={eventId} timezone={timezone} initialData={initialSuppressions} />
            </TabBoundary>
          </div>
        )}
        {tab === "deliverability" && (
          <div className="communications-panel" id="communications-panel-deliverability" role="tabpanel" aria-labelledby="communications-tab-deliverability">
            <TabBoundary name="deliverability">
              <DeliverabilityTab eventId={eventId} initialData={initialDeliverability} />
            </TabBoundary>
          </div>
        )}
        {tab === "bulk" && (
          <div className="communications-panel" id="communications-panel-bulk" role="tabpanel" aria-labelledby="communications-tab-bulk">
            <TabBoundary name="bulk">
              <BulkSendTab eventId={eventId} />
            </TabBoundary>
          </div>
        )}
      </main>
    </QueryClientProvider>
  );
}
