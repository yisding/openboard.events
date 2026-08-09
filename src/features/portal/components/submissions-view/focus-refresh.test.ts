import { describe, expect, it, vi } from "vitest";
import { subscribeToFocusRefresh } from "./focus-refresh";

describe("subscribeToFocusRefresh", () => {
  it("refreshes on a visible return, coalesces paired events, and cleans up", () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const refresh = vi.fn();
    let visible = false;
    let now = 0;
    const unsubscribe = subscribeToFocusRefresh(refresh, {
      windowTarget,
      documentTarget,
      isVisible: () => visible,
      now: () => now,
    });

    windowTarget.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    now = 100;
    windowTarget.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);

    now = 600;
    windowTarget.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);

    unsubscribe();
    now = 1_200;
    windowTarget.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
