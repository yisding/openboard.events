"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeToFocusRefresh } from "./focus-refresh";

/** Keeps server-rendered portal statuses current while a tab is left open. */
export function FocusRefresh() {
  const router = useRouter();

  useEffect(() => subscribeToFocusRefresh(
    () => router.refresh(),
    {
      windowTarget: window,
      documentTarget: document,
      isVisible: () => document.visibilityState === "visible",
    },
  ), [router]);

  return null;
}
