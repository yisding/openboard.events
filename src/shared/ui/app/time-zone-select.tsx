"use client";

import { useEffect, useMemo, useState, type SelectHTMLAttributes } from "react";
import { browserTimeZones, timeZoneOptionLabel } from "@/shared/lib/time";
import { Select } from "@/shared/ui/ui-kit";

/**
 * The one timezone picker. Three surfaces choose an event's zone — `/events/new`,
 * Settings → Details, and the onboarding wizard — and all three want the same
 * list, the same labels, and the same hydration behaviour.
 *
 * **The list is client-only until hydration, deliberately.** Both the list and
 * every label are CLDR data read from *the rendering runtime's own* `Intl` — and
 * the runtime that renders the HTML is never the browser that hydrates it.
 * Production renders in workerd; a visitor's Chromium is a third independent ICU
 * build. Several of the ~419 labels already disagree between Node 22 and
 * Chromium (Palmer Land / Palmer, Troll Station / Troll, Ürümqi / Urumqi), React
 * needs one answer, and its answer to a text mismatch is to throw the server
 * tree away and re-render the whole subtree on the client — which on Settings
 * meant the entire `SettingsShell` regenerating with an uncaught hydration error
 * in the console.
 *
 * Rendering only the selected zone before hydration reduces the disagreement to
 * a single option, and `suppressHydrationWarning` settles that one. What that
 * costs is bounded: only the *label* can differ across ICU builds, and the
 * value — the IANA id the API and every date calculation use — is not locale
 * data, so the control holds the right zone throughout. What a visitor loses in
 * the pre-hydration window is the ability to pick a *different* zone, and only
 * on the two surfaces that leave the control enabled then (`/events/new` and
 * Settings → Details; the wizard passes `disabled={!hydrated}` and so has no
 * window at all). Not shipping 419 options in the HTML is its own small win.
 *
 * A stored zone the runtime no longer lists still gets an option of its own, so
 * the control never renders blank while claiming to hold a value.
 */
export function TimeZoneSelect({
  value,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "value"> & { value: string }) {
  const zones = useMemo(browserTimeZones, []);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  const options = hydrated ? (zones.includes(value) ? zones : [value, ...zones]) : [value];

  return (
    <Select value={value} {...props}>
      {options.map((zone) => (
        <option key={zone} value={zone} suppressHydrationWarning>{timeZoneOptionLabel(zone)}</option>
      ))}
    </Select>
  );
}
