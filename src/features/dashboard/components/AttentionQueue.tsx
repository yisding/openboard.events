import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardCheck, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DashboardOverview } from "../index";

type AttentionCode = DashboardOverview["attention"][number]["code"];

const MESSAGES: Record<AttentionCode, (count: number) => string> = {
  unscheduled_accepted: (count) => `${count} accepted ${count === 1 ? "session still needs" : "sessions still need"} a time slot`,
  awaiting_decision: (count) => `${count} session ${count === 1 ? "submission is" : "submissions are"} awaiting a decision`,
  missing_assets: (count) => `${count} accepted ${count === 1 ? "speaker is" : "speakers are"} missing a bio or headshot`,
};

const ICONS: Record<AttentionCode, LucideIcon> = {
  unscheduled_accepted: CalendarClock,
  awaiting_decision: ClipboardCheck,
  missing_assets: UserX,
};

/**
 * M56 — the dashboard's lead element, not a strip buried below KPI tiles.
 * Every row is the whole answer to "what should I click right now": ranked by
 * how much is waiting (most urgent first, ties broken by the fixed code
 * order so the row order never jitters between polls), and the row itself is
 * the link — no separate "view" affordance, no cap-and-"+N more". The test
 * for every item here is "can the user click it and act?" (experience-design
 * §Surfacing 1); `attention`'s three codes already satisfy that by
 * construction, since each carries a pre-filtered `href`.
 */
export function AttentionQueue({ items }: { items: DashboardOverview["attention"] }) {
  if (items.length === 0) return null;
  const ranked = [...items].sort((a, b) => b.count - a.count);
  return (
    <section className="dashboard-attention-queue" aria-label="What needs attention">
      <header><span>Needs attention</span></header>
      <ol>
        {ranked.map((item, index) => {
          const Icon = ICONS[item.code];
          return (
            <li key={item.code}>
              <Link href={item.href}>
                <span className="dashboard-rank">{index + 1}</span>
                <Icon size={15} aria-hidden="true" />
                <span>{MESSAGES[item.code](item.count)}</span>
                <strong>{item.count}</strong>
                <ArrowRight size={15} />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
