"use client";

import { useEffect, useState } from "react";

/**
 * The two environment questions the tour asks: is this a phone, and has the
 * player asked the interface to stop moving.
 *
 * Both are read from `matchMedia` on the first render when there is a window
 * to read, and kept in sync by an effect afterwards. Reading them *only* in
 * the effect would be safer for a server-rendered tree — but every consumer
 * here mounts inside the tour layer, which is `ssr: false`, and the first
 * frame is not free: a viewport that reports "desktop" for one render puts the
 * engine on a step this screen will never show, and the engine arms and
 * persists cursor state from exactly that frame.
 */

/** Below this the sidebar is hidden and `.app-main` goes inert with the menu. */
export const TOUR_MOBILE_QUERY = "(max-width: 860px)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function matchesNow(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

/** True on the viewport where the tour drops the scrim for a bottom sheet. */
export function useMobileTourViewport(): boolean {
  return useMediaQuery(TOUR_MOBILE_QUERY);
}

/**
 * Motion preference as reactive state, so a player who flips the OS setting
 * mid-tour gets a still spotlight without a reload.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
