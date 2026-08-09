import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import type { DashboardOverview } from "../index";

const messages: Record<DashboardOverview["attention"][number]["code"], (count: number) => string> = {
  unscheduled_accepted: (count) => `${count} accepted ${count === 1 ? "session still needs" : "sessions still need"} a time slot`,
  awaiting_decision: (count) => `${count} session ${count === 1 ? "submission is" : "submissions are"} awaiting a decision`,
  missing_assets: (count) => `${count} accepted ${count === 1 ? "speaker is" : "speakers are"} missing a bio or headshot`,
};

export function AttentionStrip({ items }: { items: DashboardOverview["attention"] }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 2);
  return <section className="dashboard-attention-strip" aria-label="Also check">
    <header><AlertCircle size={16} /><b>Also check</b></header>
    {shown.map((item) => <Link key={item.code} href={item.href}><span>{messages[item.code](item.count)}</span><ArrowRight size={15} /></Link>)}
    {items.length > shown.length && <span className="dashboard-attention-more">+{items.length - shown.length} more</span>}
  </section>;
}
