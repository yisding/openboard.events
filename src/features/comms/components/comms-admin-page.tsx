"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, BellRing, FileText, History, Send, ShieldOff } from "lucide-react";
import type { EventId } from "@/shared/contracts";
import { PageHeader } from "@/shared/ui/ui-kit";
import { useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import { moveRovingTab } from "@/shared/ui/app/roving-tabs";
import { QueryBoundary } from "@/shared/ui/app/query-boundary";
import type { QuerySeed } from "@/shared/lib/query-client";
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
const TAB_IDS = TABS.map((entry) => entry.id);

/**
 * `/events/[eventId]/communications` — the comms admin page's six tabs:
 * M37's original three (Templates, Reminders, Log) plus M46's compliance and
 * deliverability ops (Suppressions, Deliverability, Bulk send). `?tab=` is
 * the source of truth so every tab deep-links; the page RSC hydrates all five
 * reads into their feature-owned TanStack keys, and a broken panel hides
 * itself rather than
 * white-screening its siblings (`<TabBoundary>`, M37 step 8).
 */
export function CommsAdminPage({
  eventId,
  timezone,
  initialTab,
  querySeeds,
  isDemo = false,
}: {
  eventId: EventId;
  timezone: string;
  initialTab: CommsTab;
  querySeeds: readonly QuerySeed[];
  /** First Fair (design §5.1) — every demo send is logged and then skipped
   * (`SkipEmail`, `src/features/comms/server/context.ts`); this only changes
   * what the header says about that, never what the tabs do. */
  isDemo?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<CommsTab>(initialTab);
  const { runGuarded, allowNextNavigation } = useGuardedAction();

  // Reports whether the switch actually happened: `runGuarded` runs the action
  // synchronously when nothing is dirty, but defers it behind a confirmation
  // otherwise. Arrow-key navigation reads the answer so keyboard focus does not
  // travel to a tab the guard just refused to select.
  function selectTab(next: CommsTab): boolean {
    if (next === tab) return false;
    const destination = `/events/${eventId}/communications?tab=${next}`;
    let selected = false;
    runGuarded(() => allowNextNavigation(() => {
      selected = true;
      setTab(next);
      router.replace(destination, { scroll: false });
    }, { destination }));
    return selected;
  }

  return (
    <QueryBoundary seeds={querySeeds}>
      <div className="page communications-page communications-admin-page">
        <PageHeader
          eyebrow="ENGAGE"
          title="Communications"
          description={isDemo
            // Not "rendered, logged and then skipped": the demo barrier stops a
            // send *before* it renders, so the log has a reason to show where a
            // subject would be, never a subject. Promising a render the product
            // deliberately never performs is what made that column read as a
            // bug (issue #679).
            ? "Demo event. Every send is logged and then skipped — no mail leaves Openboard."
            : "Design messages, automate reminders, and understand what reached your audience."}
        />
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
                onKeyDown={(event) => moveRovingTab(event, TAB_IDS, entry.id, selectTab)}
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
              <TemplatesTab eventId={eventId} />
            </TabBoundary>
          </div>
        )}
        {tab === "reminders" && (
          <div className="communications-panel" id="communications-panel-reminders" role="tabpanel" aria-labelledby="communications-tab-reminders">
            <TabBoundary name="reminders">
              <RemindersTab eventId={eventId} />
            </TabBoundary>
          </div>
        )}
        {tab === "log" && (
          <div className="communications-panel" id="communications-panel-log" role="tabpanel" aria-labelledby="communications-tab-log">
            <TabBoundary name="log">
              <CommsLogTable eventId={eventId} timezone={timezone} />
            </TabBoundary>
          </div>
        )}
        {tab === "suppressions" && (
          <div className="communications-panel" id="communications-panel-suppressions" role="tabpanel" aria-labelledby="communications-tab-suppressions">
            {isDemo && <p className="portal-note" role="status">Empty on purpose — nothing has ever actually sent, so nothing has ever bounced.</p>}
            <TabBoundary name="suppressions">
              <SuppressionsTab eventId={eventId} timezone={timezone} />
            </TabBoundary>
          </div>
        )}
        {tab === "deliverability" && (
          <div className="communications-panel" id="communications-panel-deliverability" role="tabpanel" aria-labelledby="communications-tab-deliverability">
            <TabBoundary name="deliverability">
              <DeliverabilityTab eventId={eventId} />
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
      </div>
    </QueryBoundary>
  );
}
