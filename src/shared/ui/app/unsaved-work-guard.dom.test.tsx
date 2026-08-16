/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({ pathname: "/events/one/forms/abc", push: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  usePathname: () => routing.pathname,
  useRouter: () => ({ push: routing.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const { UnsavedWorkGuardProvider, useGuardedAction, useUnsavedWorkGuard } =
  await import("./unsaved-work-guard");

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

/**
 * The palette's tour actions do not push — they PATCH a server cursor and
 * *then* hard-load the destination, several ticks after the guard's one-shot
 * allowance was granted. That gap is the whole point of these tests: the
 * router-level allowance is consumed by the `navigate` event, so without an
 * explicit `hardUnload` the organizer who has already answered "Discard
 * changes" in-app gets a second, native "Leave site?" — and cancelling that
 * one leaves the cursor moved while the page stays put.
 *
 * Asserted through the real provider rather than by matching source text,
 * because the defect lives entirely in the order two refs are consumed.
 */
let container: HTMLElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  routing.pathname = "/events/one/forms/abc";
  routing.push.mockClear();
});

type Options = { hardUnload?: boolean; destination?: string };

/** Renders one dirty guard plus a button that leaves the way the palette does. */
function mountGuardedLeaver(options: Options): { leave: () => void } {
  const calls: Array<() => void> = [];

  function Leaver() {
    useUnsavedWorkGuard(true);
    const { runGuarded, allowNextNavigation } = useGuardedAction();
    calls.length = 0;
    calls.push(() => runGuarded(() => allowNextNavigation(() => {
      // Stands in for `moveTourCursor`: the real unload happens later.
    }, options)));
    return null;
  }

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<UnsavedWorkGuardProvider><Leaver /></UnsavedWorkGuardProvider>));

  return { leave: () => act(() => calls[0]?.()) };
}

/** Confirms the in-app "Discard changes" dialog if the provider raised one. */
async function confirmDiscard(): Promise<void> {
  const confirm = [...document.querySelectorAll("button")]
    .find((button) => button.textContent === "Discard changes");
  if (confirm) await act(async () => { confirm.click(); });
}

/** Fires the unload the palette's hard navigation would trigger. */
function unloadWasBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("leaving a page with unsaved work through a host action", () => {
  it("does not double-prompt when the action declares its hard unload", async () => {
    const here = window.location.href;
    const { leave } = mountGuardedLeaver({ hardUnload: true, destination: here });

    leave();
    await confirmDiscard();

    expect(unloadWasBlocked()).toBe(false);
  });

  it("still guards an unload nobody asked for", () => {
    mountGuardedLeaver({ hardUnload: true, destination: window.location.href });

    // No leave(), so no allowance was ever granted: a stray unload is the
    // accidental tab-close the guard exists for.
    expect(unloadWasBlocked()).toBe(true);
  });

  /**
   * The regression itself: without `hardUnload` the same-destination branch
   * clears *both* allowances before the action runs, so the unload that the
   * action triggers ticks later is guarded — a native prompt behind an in-app
   * one the organizer already answered.
   */
  it("would have double-prompted a same-destination action that did not declare one", async () => {
    const { leave } = mountGuardedLeaver({ destination: window.location.href });

    leave();
    await confirmDiscard();

    expect(unloadWasBlocked()).toBe(true);
  });
});

/* --- the guided tour asking to move ------------------------------------- */

/** What the tour's `navigate` does: a guarded push, with no destination hint. */
function mountTourNavigator({ dirty }: { dirty: boolean }): { takeMeThere: () => void; setRoute: (pathname: string) => void } {
  const calls: Array<() => void> = [];

  function Page() {
    useUnsavedWorkGuard(dirty);
    const { runGuarded, allowNextNavigation } = useGuardedAction();
    calls.length = 0;
    calls.push(() => runGuarded(() => allowNextNavigation(() => routing.push("/events/one/agenda"))));
    return null;
  }

  // A fresh element every time: React bails out of re-rendering a subtree
  // handed back the identical element reference, and this harness needs the
  // provider to actually re-read `usePathname`.
  const tree = () => <UnsavedWorkGuardProvider><Page /></UnsavedWorkGuardProvider>;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(tree()));

  return {
    takeMeThere: () => act(() => calls[0]?.()),
    // The page component stays mounted across the route change on purpose:
    // that is the leak being asserted against. A registration retired by its
    // own unmount was never the problem.
    setRoute: (pathname: string) => act(() => {
      routing.pathname = pathname;
      root?.render(tree());
    }),
  };
}

function discardDialog(): HTMLElement | null {
  return [...document.querySelectorAll("dialog h2")]
    .find((heading) => heading.textContent === "Discard unsaved work?")?.closest("dialog") ?? null;
}

describe("a guided tour navigating away from unsaved work", () => {
  /**
   * First Fair. "Take me there" from a dirty form builder used to do nothing
   * at all — no navigation, no prompt, no message — because the tour measured
   * "am I already here?" against `window.location`, which an interception has
   * already moved. The contract this pins is the one the coach depends on:
   * a tour navigation either travels or asks, and asking is a visible thing.
   */
  it("raises the prompt instead of swallowing the trip, and travels on accept", async () => {
    const { takeMeThere } = mountTourNavigator({ dirty: true });

    takeMeThere();

    expect(routing.push).not.toHaveBeenCalled();
    expect(discardDialog()).not.toBe(null);

    await confirmDiscard();

    expect(routing.push).toHaveBeenCalledWith("/events/one/agenda");
    expect(discardDialog()).toBe(null);
  });

  it("travels immediately when there is nothing to discard", () => {
    const { takeMeThere } = mountTourNavigator({ dirty: false });

    takeMeThere();

    expect(discardDialog()).toBe(null);
    expect(routing.push).toHaveBeenCalledWith("/events/one/agenda");
  });
});

describe("unsaved work that outlives the page holding it", () => {
  /**
   * Observed live: minutes after leaving a dirty form builder the organizer
   * was asked to "Discard unsaved work?" on Evaluation, a page with no draft
   * on it — and a later unload was blocked on behalf of a template that had
   * already been saved. A guard is normally retired by its own unmount, but
   * that is exactly the cleanup nothing else can vouch for, so the route it
   * registered on is now its lease.
   */
  it("drops a registration the route change left behind, so no later unload is blocked", () => {
    const { setRoute } = mountTourNavigator({ dirty: true });
    expect(unloadWasBlocked()).toBe(true);

    setRoute("/events/one/evaluation");

    expect(unloadWasBlocked()).toBe(false);
  });

  it("stops asking about work the organizer has already left", () => {
    const { takeMeThere, setRoute } = mountTourNavigator({ dirty: true });
    takeMeThere();
    expect(discardDialog()).not.toBe(null);

    setRoute("/events/one/evaluation");

    // The out-of-band dialog: a decision raised on the form builder, still
    // open — and still holding a navigation promise — two pages later.
    expect(discardDialog()).toBe(null);
  });

  it("keeps the draft guarded across a search-only move within the same page", () => {
    // The form builder's `?step=` and Communications' `?tab=` keep the same
    // editor mounted with its draft intact; sweeping there would drop a live
    // guard mid-edit.
    const { setRoute } = mountTourNavigator({ dirty: true });

    setRoute("/events/one/forms/abc");

    expect(unloadWasBlocked()).toBe(true);
  });
});
