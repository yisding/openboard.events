import type { TimeStyle } from "@/shared/lib/time";
import { formatInZone } from "@/shared/lib/time";
import { Dash } from "./dash";

/**
 * Every rendered time in the product goes through here, and every rendered time
 * carries its zone label. A bare `toLocaleString()` renders in the *viewer's*
 * zone, so an organizer in New York and a speaker in Berlin read different hours
 * off the same deadline and neither of them knows it.
 *
 * `tz` is the event's timezone, not the viewer's — pass `event.timezone`.
 */
export function TzTime({
  instant,
  tz,
  style = "dateTime",
  secondary,
}: {
  instant: Date | string | number | null | undefined;
  tz: string;
  style?: TimeStyle;
  /** A second line, e.g. the time under the date in a table cell. */
  secondary?: TimeStyle;
}) {
  if (instant === null || instant === undefined || instant === "") return <Dash />;
  const value = formatInZone(instant, tz, style);
  const iso = new Date(instant).toISOString();
  if (!secondary) return <time dateTime={iso}>{value}</time>;
  return (
    <time className="table-date" dateTime={iso}>
      {value}
      <small>{formatInZone(instant, tz, secondary)}</small>
    </time>
  );
}
