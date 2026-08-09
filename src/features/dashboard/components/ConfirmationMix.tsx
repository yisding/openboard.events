import { Users } from "lucide-react";
import type { DashboardOverview } from "../index";
import { DashboardEmpty, WidgetTitle } from "./TopSpeakersList";

const items = [
  { key: "confirmed", label: "Confirmed", color: "#24866e" },
  { key: "unconfirmed", label: "Unconfirmed", color: "#ad741a" },
  { key: "declined", label: "Declined", color: "#c54a54" },
] as const;

export function ConfirmationMix({ mix }: { mix: DashboardOverview["speakerTracking"]["confirmationMix"] }) {
  const total = mix.confirmed + mix.unconfirmed + mix.declined;
  if (total === 0) return <DashboardEmpty icon={<Users size={22} />} title="No data" hint="Accept a submission to see confirmation status." />;
  let offset = 0;
  return <section className="dashboard-widget dashboard-confirmation">
    <WidgetTitle title="Speaker confirmation mix" hint="Accepted speakers only" />
    <div className="dashboard-donut-wrap">
      <svg className="dashboard-donut" viewBox="0 0 42 42" role="img" aria-label={`${mix.confirmed} confirmed, ${mix.unconfirmed} unconfirmed, ${mix.declined} declined`}>
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#efedf3" strokeWidth="6" />
        {items.map((item) => {
          const percent = (mix[item.key] / total) * 100;
          const circle = <circle key={item.key} cx="21" cy="21" r="15.9155" fill="none" stroke={item.color} strokeWidth="6" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-offset} />;
          offset += percent;
          return circle;
        })}
        <text x="21" y="20" textAnchor="middle">{total}</text><text className="dashboard-donut-label" x="21" y="25" textAnchor="middle">speakers</text>
      </svg>
      <ul>{items.map((item) => <li key={item.key}><i style={{ background: item.color }} /><span>{item.label}</span><b>{mix[item.key]}</b><small>{Math.round((mix[item.key] / total) * 100)}%</small></li>)}</ul>
    </div>
  </section>;
}
