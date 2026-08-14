import type { TimeStyle } from "@/shared/lib/time";
import { formatInZone, zoneAbbreviation } from "@/shared/lib/time";
import { Dash } from "./dash";

export function formatTzTime(instant: Date | string | number, tz: string, style: TimeStyle): string {
  const value = formatInZone(instant, tz, style);
  const usesStyleShortcut = typeof style === "object"
    && (style.dateStyle !== undefined || style.timeStyle !== undefined);
  const needsZone = typeof style === "object"
    && style.timeZoneName === undefined
    && (usesStyleShortcut || (
      style.hour === undefined
      && style.minute === undefined
      && style.second === undefined
    ));
  return needsZone ? `${value} ${zoneAbbreviation(instant, tz)}` : value;
}

function withoutTrailingZone(value: string, instant: Date | string | number, tz: string): string {
  const suffix = ` ${zoneAbbreviation(instant, tz)}`;
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

/**
 * Every rendered time in the product goes through here, and its zone is named
 * either inline or by visible surrounding context. A bare `toLocaleString()`
 * renders in the *viewer's* zone, so an organizer in New York and a speaker in
 * Berlin read different hours off the same deadline and neither knows it.
 *
 * `tz` is the event's timezone, not the viewer's — pass `event.timezone`.
 */
export function TzTime({
  instant,
  tz,
  style = "dateTime",
  secondary,
  zoneDisplay = "inline",
}: {
  instant: Date | string | number | null | undefined;
  tz: string;
  style?: TimeStyle;
  /** A second line, e.g. the time under the date in a table cell. */
  secondary?: TimeStyle;
  /** Use context only when a visible surrounding label already names `tz`. */
  zoneDisplay?: "inline" | "context";
}) {
  if (instant === null || instant === undefined || instant === "") return <Dash />;
  const formatted = formatTzTime(instant, tz, style);
  const value = zoneDisplay === "context" ? withoutTrailingZone(formatted, instant, tz) : formatted;
  const iso = new Date(instant).toISOString();
  if (!secondary) return <time dateTime={iso}>{value}</time>;
  const secondaryValue = formatTzTime(instant, tz, secondary);
  return (
    <time className="table-date" dateTime={iso}>
      {withoutTrailingZone(value, instant, tz)}
      <small>{zoneDisplay === "context" ? withoutTrailingZone(secondaryValue, instant, tz) : secondaryValue}</small>
    </time>
  );
}
