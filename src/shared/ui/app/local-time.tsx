"use client";

import { useEffect, useState } from "react";
import { formatInZone, viewerTimeZone, type TimeStyle } from "@/shared/lib/time";
import { Dash } from "./dash";

/**
 * A timestamp with no event to anchor it to — an admin session, an audit entry,
 * an organization invitation — rendered in the viewer's own zone.
 *
 * `TzTime` is still the right component everywhere an event's timezone is in
 * scope; this is its deliberate counterpart, not a shortcut around it.
 *
 * A bare `new Date(x).toLocaleString()` cannot do this job in an SSR'd client
 * component: the Worker formats in UTC, the browser re-formats in the viewer's
 * zone, the two strings differ, and React tears the tree down with #418 — the
 * same defect `review-queue-view.tsx` documents. So the first render, on both
 * sides of hydration, is UTC; the viewer's zone is adopted in an effect, after
 * React has matched the trees. `<time dateTime>` carries the exact instant
 * throughout, so the value is machine-readable even before that swap.
 */
export function LocalTime({
  instant,
  style = "dateTime",
}: {
  instant: Date | string | number | null | undefined;
  style?: TimeStyle;
}) {
  const [zone, setZone] = useState("UTC");
  useEffect(() => setZone(viewerTimeZone()), []);
  if (instant === null || instant === undefined || instant === "") return <Dash />;
  return <time dateTime={new Date(instant).toISOString()}>{formatInZone(instant, zone, style)}</time>;
}
