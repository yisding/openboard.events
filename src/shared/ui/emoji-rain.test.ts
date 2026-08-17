/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emojiRain } from "./emoji-rain";

/**
 * A stand-in for the popover API, which is how the overlay joins the top layer.
 * Recording the show is enough here — `top-layer.test.ts` covers the mechanism.
 */
function stubPopoverApi(): () => void {
  const prototype = HTMLElement.prototype as unknown as Record<string, unknown>;
  const before = { show: prototype.showPopover, hide: prototype.hidePopover };
  prototype.showPopover = function showPopover(this: HTMLElement) { this.setAttribute("data-open", ""); };
  prototype.hidePopover = function hidePopover(this: HTMLElement) {
    if (!this.hasAttribute("data-open")) throw new Error("InvalidStateError");
    this.removeAttribute("data-open");
  };
  return () => {
    if (before.show === undefined) delete prototype.showPopover; else prototype.showPopover = before.show;
    if (before.hide === undefined) delete prototype.hidePopover; else prototype.hidePopover = before.hide;
  };
}

let restorePopover: (() => void) | null = null;

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  restorePopover = stubPopoverApi();
  reducedMotion(false);
});

afterEach(() => {
  restorePopover?.();
  restorePopover = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function overlay() {
  return document.querySelector<HTMLElement>(".egg-rain");
}

describe("emojiRain", () => {
  // The burst that most deserves to be seen is the tour's curtain call, and
  // that step is a modal <dialog> — the top layer, above every z-index. The
  // confetti used to rain behind the payoff screen and only show up once the
  // modal was dismissed, celebrating the dashboard instead of the moment.
  it("joins the top layer, so a burst fired over a modal lands on top of it", () => {
    document.body.insertAdjacentHTML("beforeend", "<dialog open><p>You just ran a conference.</p></dialog>");

    emojiRain(["🎉"], 4);

    expect(overlay()?.getAttribute("popover")).toBe("manual");
    expect(overlay()?.hasAttribute("data-open")).toBe(true);
  });

  it("drops the emoji it was asked for and cleans itself up", () => {
    emojiRain(["🎉", "✨"], 6);

    expect(overlay()?.querySelectorAll("span")).toHaveLength(6);
    expect(overlay()?.getAttribute("aria-hidden")).toBe("true");

    vi.advanceTimersByTime(6000);
    expect(overlay()).toBe(null);
  });

  it("stays out of the way entirely for someone who asked for less motion", () => {
    reducedMotion(true);

    emojiRain(["🎉"], 6);

    expect(overlay()).toBe(null);
  });
});
