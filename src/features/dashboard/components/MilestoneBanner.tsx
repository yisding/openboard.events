"use client";

import Link from "next/link";
import { PartyPopper, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { EventId } from "@/shared/contracts";
import { computeMilestones, type Milestone } from "../lib/milestones";
import type { DashboardOverview } from "../index";

/**
 * M60 — "Milestone acknowledgments... make the tool feel like a colleague."
 * `computeMilestones` decides *which* facts are true; this component decides
 * which of those the organizer has already seen (localStorage, same
 * `openboard:` key convention `DataTable`'s column-visibility state uses),
 * so a milestone that stays true forever (the CFP does not reopen) does not
 * nag on every dashboard visit after the first acknowledgment.
 */
function storageKey(eventId: EventId, milestoneId: string): string {
  return `openboard:milestone-seen:${eventId}:${milestoneId}`;
}

function readDismissed(eventId: EventId, milestones: Milestone[]): Set<string> {
  if (typeof window === "undefined") return new Set();
  const dismissed = new Set<string>();
  for (const milestone of milestones) {
    if (window.localStorage.getItem(storageKey(eventId, milestone.id)) === "1") dismissed.add(milestone.id);
  }
  return dismissed;
}

export function MilestoneBanner({ eventId, overview }: { eventId: EventId; overview: DashboardOverview }) {
  const milestones = useMemo(() => computeMilestones(overview), [overview]);
  // Read on mount rather than during render: localStorage does not exist on
  // the server, and a mismatch between the two passes is a hydration error —
  // every milestone starts "not yet dismissed" on first paint, same pattern
  // `DataTable`'s column-visibility read uses.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => setDismissed(readDismissed(eventId, milestones)), [eventId, milestones]);

  const visible = milestones.filter((milestone) => !dismissed.has(milestone.id));
  if (visible.length === 0) return null;

  function dismiss(milestone: Milestone) {
    window.localStorage.setItem(storageKey(eventId, milestone.id), "1");
    setDismissed((current) => new Set(current).add(milestone.id));
  }

  return (
    <div className="dashboard-milestones">
      {visible.map((milestone) => (
        <div key={milestone.id} className="dashboard-milestone">
          <span className="dashboard-milestone-icon"><PartyPopper size={16} /></span>
          <Link href={milestone.href}>
            <b>{milestone.title}</b>
            <span>{milestone.detail}</span>
          </Link>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(milestone)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
