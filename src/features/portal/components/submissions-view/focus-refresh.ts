type ListenerTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

type FocusRefreshEnvironment = {
  windowTarget: ListenerTarget;
  documentTarget: ListenerTarget;
  isVisible: () => boolean;
  now?: () => number;
  dedupeMs?: number;
};

/**
 * Refresh server-rendered data when a speaker returns to the tab. Browsers can
 * emit both `visibilitychange` and `focus` for one return, so coalesce that pair
 * rather than issuing two RSC requests.
 */
export function subscribeToFocusRefresh(
  refresh: () => void,
  { windowTarget, documentTarget, isVisible, now = Date.now, dedupeMs = 500 }: FocusRefreshEnvironment,
): () => void {
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  const refreshIfVisible = () => {
    if (!isVisible()) return;
    const refreshAt = now();
    if (refreshAt - lastRefreshAt < dedupeMs) return;
    lastRefreshAt = refreshAt;
    refresh();
  };

  windowTarget.addEventListener("focus", refreshIfVisible);
  documentTarget.addEventListener("visibilitychange", refreshIfVisible);
  return () => {
    windowTarget.removeEventListener("focus", refreshIfVisible);
    documentTarget.removeEventListener("visibilitychange", refreshIfVisible);
  };
}
