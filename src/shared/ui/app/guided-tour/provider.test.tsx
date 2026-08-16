/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTourMirror } from "./mirror";
import { emitTourSignal } from "./signals";
import type { TourBootstrap, TourChapter, TourCursorPatch, TourStateWire, TourStep, TourTransport } from "./types";

const harness = vi.hoisted(() => ({
  pathname: "/events/evt-1/dashboard",
  search: "",
  push: vi.fn<(href: string) => void>(),
  toast: vi.fn(),
  rain: vi.fn(),
  runGuarded: (action: () => void) => action(),
  allowNextNavigation: (action?: () => void) => action?.(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => harness.pathname,
  useSearchParams: () => new URLSearchParams(harness.search),
  useRouter: () => ({ push: harness.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/shared/ui/emoji-rain", () => ({ emojiRain: harness.rain }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useGuardedAction: () => ({ runGuarded: harness.runGuarded, allowNextNavigation: harness.allowNextNavigation }),
}));

const { GuidedTourMount } = await import("./provider");

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

/* --- fixtures ----------------------------------------------------------- */

const CHAPTERS: readonly TourChapter[] = [
  { id: "deck", name: "Command deck" },
  { id: "grid", name: "The grid", mobileNote: "Scheduling wants a bigger screen — come back on a laptop for this one." },
  { id: "live", name: "Go live" },
];

/* Anchor specs are module constants because the engine keys its resolver on
   their identity — exactly as a real script's step objects are. */
const TABS_ANCHOR = { kind: "selector", css: ".dashboard-tabs" } as const;
const MISSING_ANCHOR = { kind: "selector", css: ".never-mounts" } as const;
const DIALOG_ANCHOR = { kind: "tour-id", id: "abstracts.decision-notify" } as const;

const STEPS: readonly TourStep[] = [
  {
    id: "deck.look", chapter: "deck", kind: "beat",
    title: "Everything that needs you, ranked.", body: "Two minutes here beats an inbox.",
    anchor: TABS_ANCHOR, placement: "bottom",
  },
  {
    id: "grid.resolve", chapter: "grid", kind: "act", desktopOnly: true,
    title: "Fix it.", body: "Move yours, or move the other one.",
    anchor: TABS_ANCHOR,
    objective: { via: "world", fact: "conflictCount", delta: "decreased" },
    hint: "Open the conflict row and change the room.",
    reward: { emoji: "🗓", line: "Two rooms, one time, zero apologies to write." },
  },
  {
    id: "live.publish", chapter: "live", kind: "act",
    title: "Publish the agenda.", body: "Until now, nothing you did was visible outside.",
    anchor: TABS_ANCHOR,
    objective: { via: "world", fact: "publishedSessions", delta: "increased" },
  },
];

/** A detour. Its chapter is `grid`, which is precisely the trap: skipping
 *  "this chapter" from inside a quest must not touch the grid's own steps. */
const QUEST_STEP: TourStep = {
  id: "quest.outbox", chapter: "grid", kind: "observe", optional: true,
  title: "Read the mail you did not send.", body: "Rendered, logged, and going nowhere.",
  anchor: TABS_ANCHOR,
};

type Server = {
  state: TourStateWire;
  reads: number;
  patches: TourCursorPatch[];
  records: Array<{ stepId: string; outcome: string }>;
  transport: TourTransport;
};

function makeServer(initial: Partial<TourStateWire> = {}): Server {
  const server: Server = {
    state: {
      chapter: "deck", stepId: "deck.look", status: "active",
      armedStepId: null, armedBaseline: null,
      completed: [], questsDone: [], world: { conflictCount: 3, publishedSessions: 0 },
      ...initial,
    },
    reads: 0,
    patches: [],
    records: [],
    transport: {
      read: async () => {
        server.reads += 1;
        return { ...server.state };
      },
      patch: async (patch) => {
        server.patches.push(patch);
        server.state = {
          ...server.state,
          chapter: patch.chapter,
          stepId: patch.stepId,
          status: patch.status,
          ...(patch.armedStepId === undefined ? {} : { armedStepId: patch.armedStepId }),
          ...(patch.armedBaseline === undefined ? {} : { armedBaseline: patch.armedBaseline }),
        };
        return { ...server.state };
      },
      record: async (stepId, outcome) => {
        server.records.push({ stepId, outcome });
      },
    },
  };
  return server;
}

function makeBootstrap(server: Server, overrides: Partial<TourBootstrap> = {}): TourBootstrap {
  return {
    scopeId: "evt-1",
    statePath: "events/evt-1/tour",
    stepsPath: "events/evt-1/tour/steps",
    transport: server.transport,
    chapters: CHAPTERS,
    steps: STEPS,
    cursor: { chapter: server.state.chapter, stepId: server.state.stepId, status: server.state.status },
    completed: [],
    questsDone: [],
    world: server.state.world,
    context: { eventId: "evt-1", slug: "worlds-fair-demo" },
    ...overrides,
  };
}

/* --- rendering ---------------------------------------------------------- */

let cleanup: Array<() => Promise<void>> = [];
let mobile = false;
let reducedMotion = false;

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: query.includes("max-width") ? mobile : query.includes("reduced-motion") ? reducedMotion : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

async function render(bootstrap: TourBootstrap | null, children?: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<GuidedTourMount bootstrap={bootstrap}>{children}</GuidedTourMount>));
  cleanup.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

/**
 * Let queued microtasks and any timer-driven work settle.
 *
 * Long waits are advanced in chunks, each in its own `act`: React counts
 * consecutive commits with no paint between them and aborts at fifty, and
 * driving ten minutes of a two-second poll inside a single flush trips that
 * counter on an engine that is behaving perfectly.
 */
async function tick(ms = 0) {
  if (ms <= 0) {
    await act(async () => { await Promise.resolve(); });
    return;
  }
  for (let elapsed = 0; elapsed < ms; elapsed += 20_000) {
    const slice = Math.min(20_000, ms - elapsed);
    await act(async () => { await vi.advanceTimersByTimeAsync(slice); });
  }
}

/** Drives the browser signal TanStack's focus manager listens to. */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
  // happy-dom does not bubble the document event up to the window the way a
  // browser does, and the window is where the query client listens.
  window.dispatchEvent(new Event("visibilitychange"));
}

function coach(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tour-coach");
}

function control(label: string): HTMLElement {
  const match = [...document.querySelectorAll<HTMLElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`No control named ${label}`);
  return match;
}

beforeEach(() => {
  vi.useFakeTimers();
  mobile = false;
  reducedMotion = false;
  stubMatchMedia();
  harness.pathname = "/events/evt-1/dashboard";
  harness.search = "";
  harness.push.mockClear();
  harness.toast.mockClear();
  harness.rain.mockClear();
  window.localStorage.clear();
});

afterEach(async () => {
  setVisibility("visible");
  while (cleanup.length > 0) await cleanup.pop()?.();
  cleanup = [];
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/* --- the tests ---------------------------------------------------------- */

describe("mounting", () => {
  it("renders its children untouched when there is no tour", async () => {
    // A real event, and a reviewer on a demo event, both arrive here.
    const container = await render(null, <main id="page">Dashboard</main>);
    expect(container.querySelector("#page")?.textContent).toBe("Dashboard");
    expect(coach()).toBe(null);
    expect(document.querySelector(".tour-scrim")).toBe(null);
  });

  it("draws the coach beside the page rather than around it", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const container = await render(makeBootstrap(makeServer()), <main id="page">Dashboard</main>);
    await tick();
    expect(container.querySelector("#page")?.textContent).toBe("Dashboard");
    expect(coach()?.textContent).toContain("Everything that needs you, ranked.");
    expect(coach()?.textContent).toContain("Chapter 1 of 3 — Command deck");
  });
});

describe("objective verification", () => {
  it("advances on the world reaching the objective, and records the step exactly once", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server));
    await tick();

    // Arming persists the baseline server-side; without that a reload would
    // re-anchor to the post-action value and hide the work already done.
    const armed = server.patches.find((patch) => patch.armedStepId === "grid.resolve");
    expect(armed?.armedBaseline).toEqual({ conflictCount: 3, publishedSessions: 0 });
    expect(coach()?.textContent).toContain("Waiting for you…");

    server.state = { ...server.state, world: { conflictCount: 2, publishedSessions: 0 } };
    await tick(2_100);
    expect(coach()?.textContent).toContain("Two rooms, one time, zero apologies to write.");
    expect(harness.rain).toHaveBeenCalledWith(["🗓"], 6);

    // Keep polling the same satisfying snapshot: the step must not re-record.
    await tick(10_000);
    expect(server.records.filter((entry) => entry.stepId === "grid.resolve")).toHaveLength(1);
    expect(server.state.stepId).toBe("live.publish");
  });

  it("polls only while an act step is armed", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer();
    await render(makeBootstrap(server));
    await tick(60_000);
    // `deck.look` is a beat. A narration step has nothing to watch for.
    expect(server.reads).toBe(0);
  });

  it("stretches the interval once a step has sat still, and stops after ten minutes", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server));
    await tick(30_000);
    const busy = server.reads;
    expect(busy).toBeGreaterThan(10);

    await tick(60_000);
    const calm = server.reads - busy;
    // Sixty seconds at the two-second cadence would be thirty reads.
    expect(calm).toBeLessThan(20);

    await tick(600_000);
    const stopped = server.reads;
    await tick(120_000);
    expect(server.reads).toBe(stopped);
    // A tutorial that hangs is worse than one that yields.
    expect(coach()?.textContent).toContain("Take your time — press Continue when you're ready.");
  });
});

describe("poll discipline", () => {
  it("stops polling while the tab is hidden and catches up the moment it comes back", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server));
    await tick(6_000);
    const beforeHiding = server.reads;
    expect(beforeHiding).toBeGreaterThan(0);

    setVisibility("hidden");
    await tick(20_000);
    expect(server.reads).toBe(beforeHiding);

    // Coming back from the impersonation tab is exactly the moment the
    // objective is most likely to already be satisfied, so it is not a moment
    // to make someone wait two seconds.
    server.state = { ...server.state, world: { conflictCount: 2, publishedSessions: 0 } };
    setVisibility("visible");
    await tick(100);
    expect(server.reads).toBeGreaterThan(beforeHiding);
    expect(coach()?.textContent).toContain("Two rooms, one time, zero apologies to write.");
  });

  it("takes a signal as a nudge to look now, never as the verdict", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server));
    // Let the arming fetch land first, so the reads below can only be the
    // signal's — 100 ms is well inside the two-second poll interval.
    await tick(100);
    const before = server.reads;

    // A signal with the world unmoved must not complete anything.
    emitTourSignal("agenda.session-saved");
    await tick(100);
    expect(server.reads).toBeGreaterThan(before);
    expect(coach()?.textContent).toContain("Waiting for you…");

    server.state = { ...server.state, world: { conflictCount: 1, publishedSessions: 0 } };
    emitTourSignal("agenda.session-saved");
    await tick(100);
    expect(coach()?.textContent).toContain("Two rooms, one time, zero apologies to write.");
  });
});

describe("reduced motion", () => {
  it("brings the anchor into view without animating the page under someone", async () => {
    reducedMotion = true;
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const tabs = document.querySelector<HTMLElement>(".dashboard-tabs");
    if (!tabs) throw new Error("fixture did not mount");
    const scrolled = vi.fn();
    tabs.scrollIntoView = scrolled;
    await render(makeBootstrap(makeServer()));
    await tick();
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto", block: "center" }));
  });

  it("scrolls smoothly when nobody asked it not to", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const tabs = document.querySelector<HTMLElement>(".dashboard-tabs");
    if (!tabs) throw new Error("fixture did not mount");
    const scrolled = vi.fn();
    tabs.scrollIntoView = scrolled;
    await render(makeBootstrap(makeServer()));
    await tick();
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });
});

describe("leaving", () => {
  it("pauses on Escape with no confirmation dialog, and leaves a way back in", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer();
    await render(makeBootstrap(server));
    await tick();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await tick();

    expect(document.querySelector("dialog")).toBe(null);
    expect(server.patches.filter((patch) => patch.status === "paused")).toHaveLength(1);
    expect(harness.toast).toHaveBeenCalledWith(expect.stringContaining("Paused at Chapter 1 — Command deck"));
    expect(coach()).toBe(null);
    expect(document.querySelector(".tour-pill")).not.toBe(null);
    expect(control("Resume the tour")).toBeTruthy();
  });

  it("tells the host the status changed, so its own resume surfaces can follow", async () => {
    // The host's copy of the status came from a server render, and a soft
    // navigation reuses it for the life of the session. Without this callback
    // the command palette keeps offering only "Restart the guided tour" after
    // a pause — throwing away the chapters the player is trying to keep.
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer();
    const statuses: string[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <GuidedTourMount bootstrap={makeBootstrap(server)} onStatusChange={(status) => statuses.push(status)} />,
    ));
    cleanup.push(async () => { await act(async () => root.unmount()); container.remove(); });
    await tick();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await tick();
    expect(statuses.at(-1)).toBe("paused");

    await act(async () => control("Resume the tour").click());
    await tick();
    expect(statuses.at(-1)).toBe("active");
  });

  it("leaves Escape alone while a dialog owns it", async () => {
    document.body.insertAdjacentHTML("beforeend", '<dialog open><button>Confirm</button></dialog>');
    const server = makeServer();
    await render(makeBootstrap(server));
    await tick();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await tick();
    expect(server.patches.some((patch) => patch.status === "paused")).toBe(false);
  });

  it("leaves Escape alone when the thing that owned it closed itself on the way past", async () => {
    // The command palette, found live. Its own handler answers Escape with
    // `preventDefault` + `stopPropagation` + `onClose`, and React flushes that
    // discrete update synchronously — so this document-level listener runs
    // *after* the `<dialog>` has already gone, the "is a dialog open" guard
    // sees an empty top layer, and the tour quietly paused itself on a
    // keystroke the player spent dismissing something else.
    document.body.insertAdjacentHTML("beforeend", '<dialog open class="palette"><input /></dialog>');
    const palette = document.querySelector<HTMLDialogElement>("dialog.palette");
    const input = palette?.querySelector("input");
    if (!palette || !input) throw new Error("fixture did not mount");
    palette.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      palette.removeAttribute("open");
    });

    const server = makeServer();
    await render(makeBootstrap(server));
    await tick();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await tick();

    expect(document.querySelector("dialog[open]")).toBe(null);
    expect(server.patches.some((patch) => patch.status === "paused")).toBe(false);
    expect(coach()).not.toBe(null);
  });

  it("records a skipped step without celebrating it", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server));
    await tick();
    await act(async () => control("Skip this").click());
    await tick();
    expect(server.records).toContainEqual({ stepId: "grid.resolve", outcome: "skipped" });
    expect(harness.rain).not.toHaveBeenCalled();
    expect(server.state.stepId).toBe("live.publish");
  });
});

describe("anchoring", () => {
  it("re-measures on scroll instead of dismissing itself", async () => {
    // The inverse of `first-run-hints`, deliberately: a tutorial that scrolls
    // its own target into view must not close in the process.
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const tabs = document.querySelector<HTMLElement>(".dashboard-tabs");
    if (!tabs) throw new Error("fixture did not mount");
    tabs.getBoundingClientRect = () => new DOMRect(100, 400, 200, 40);
    await render(makeBootstrap(makeServer()));
    await tick();
    expect(coach()?.style.top).toBe("450px");

    tabs.getBoundingClientRect = () => new DOMRect(100, 120, 200, 40);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(coach()).not.toBe(null);
    expect(coach()?.style.top).toBe("170px");
  });

  it("degrades to a centred card with a way there when the anchor never mounts", async () => {
    const server = makeServer();
    await render(makeBootstrap(server, {
      steps: [{ ...STEPS[0], anchor: MISSING_ANCHOR, route: { path: "/events/:eventId/agenda" } } as TourStep, ...STEPS.slice(1)],
    }));
    await tick(6_500);
    // No step ever fails to render.
    expect(coach()?.className).toContain("tour-coach-centred");
    expect(coach()?.textContent).toContain("Everything that needs you, ranked.");
    expect(document.querySelector(".tour-scrim")).toBe(null);
    await act(async () => control("Take me there").click());
    expect(harness.push).toHaveBeenCalledWith("/events/evt-1/agenda");
  });

  it("still travels when an intercepted navigation has moved the address bar ahead of the router", async () => {
    // First Fair, found live: the unsaved-work guard answers the Navigation
    // API with `intercept()`, which commits the URL *before* the organizer has
    // answered "Discard unsaved work?". Decline it and `window.location` names
    // a page the router never rendered — the state reproduced here. Measuring
    // "am I already there?" against the browser instead of the router turned
    // the coach's own control into a silent no-op: no navigation, no prompt,
    // no message, and only ever on a dirty page.
    const restore = window.location.href;
    window.history.replaceState(null, "", "/events/evt-1/agenda");
    cleanup.push(async () => { window.history.replaceState(null, "", restore); });
    const server = makeServer();
    await render(makeBootstrap(server, {
      steps: [{ ...STEPS[0], anchor: MISSING_ANCHOR, route: { path: "/events/:eventId/agenda" } } as TourStep, ...STEPS.slice(1)],
    }));
    await tick(6_500);

    await act(async () => control("Take me there").click());

    expect(harness.push).toHaveBeenCalledWith("/events/evt-1/agenda");
  });

  it("does not offer a trip to the page the player is already on", async () => {
    // The usual case: the tour navigated here on entry, so `navigate` would
    // return without pushing and the button would be pure decoration. The
    // notice has to stop claiming the control is on another screen, too.
    harness.pathname = "/events/evt-1/agenda";
    const server = makeServer();
    await render(makeBootstrap(server, {
      steps: [{ ...STEPS[0], anchor: MISSING_ANCHOR, route: { path: "/events/:eventId/agenda" } } as TourStep, ...STEPS.slice(1)],
    }));
    await tick(6_500);
    expect(coach()?.textContent).not.toContain("Take me there");
    expect(coach()?.textContent).toContain("Nothing to point at yet");
  });

  it("offers a step with no route of its own the way back to the page its chapter opened", async () => {
    // "Confirm the queue" has no route on purpose — it happens in a dialog the
    // chapter has already opened, and navigating on entry would close it. That
    // left a player who wandered off with a card that had nothing to offer:
    // no way back, and a notice claiming the control "appears once you have
    // started" while they were on another page entirely.
    harness.pathname = "/events/evt-1/dashboard";
    const server = makeServer({ chapter: "grid", stepId: "grid.confirm" });
    await render(makeBootstrap(server, {
      steps: [
        { ...STEPS[0], chapter: "grid", id: "grid.open", route: { path: "/events/:eventId/abstracts" } } as TourStep,
        {
          id: "grid.confirm", chapter: "grid", kind: "act",
          title: "Confirm the queue.", body: "Queue decision emails once it reads the way you expect.",
          anchor: MISSING_ANCHOR,
          objective: { via: "world", fact: "conflictCount", delta: "decreased" },
        } as TourStep,
      ],
    }));
    await tick(6_500);

    expect(coach()?.textContent).toContain("That control isn't on this screen right now");
    await act(async () => control("Take me there").click());
    expect(harness.push).toHaveBeenCalledWith("/events/evt-1/abstracts");
  });

  it("counts a filter the organizer added as still being on the step's page", async () => {
    // `trip.find-gap` routes to a bare `/speakers` and asks the organizer to
    // filter it down to `?missing=either`. Exact-set equality then read the
    // filtered roster as a *different* page: the next step said the control
    // "isn't on this screen right now" and offered a trip whose only effect
    // would have been to throw the filter away again.
    harness.pathname = "/events/evt-1/agenda";
    harness.search = "view=conflicts&room=main-stage";
    const server = makeServer();
    await render(makeBootstrap(server, {
      steps: [{ ...STEPS[0], anchor: MISSING_ANCHOR, route: { path: "/events/:eventId/agenda" } } as TourStep, ...STEPS.slice(1)],
    }));
    await tick(6_500);

    expect(coach()?.textContent).not.toContain("Take me there");
    expect(coach()?.textContent).toContain("Nothing to point at yet");
  });

  it("portals into an open dialog and suppresses its own scrim there", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<dialog open class="modal-shell"><button data-tour="abstracts.decision-notify">Notify</button></dialog>',
    );
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server, {
      steps: STEPS.map((step) => (step.id === "grid.resolve" ? { ...step, anchor: DIALOG_ANCHOR, spotlight: false } : step)),
    }));
    await tick();
    const dialog = document.querySelector("dialog");
    expect(dialog?.querySelector(".tour-coach")).not.toBe(null);
    // Nothing z-indexed can paint above the top layer; the dialog's own
    // ::backdrop is already the scrim.
    expect(document.querySelector(".tour-scrim")).toBe(null);
  });

  it("spotlights with a real hole the player can click through", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const tabs = document.querySelector<HTMLElement>(".dashboard-tabs");
    if (!tabs) throw new Error("fixture did not mount");
    tabs.getBoundingClientRect = () => new DOMRect(100, 200, 240, 44);
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server));
    await tick();
    const scrim = document.querySelector<SVGElement>(".tour-scrim");
    const hole = document.querySelector<SVGRectElement>(".tour-scrim-hole");
    expect(scrim).not.toBe(null);
    expect(hole?.getAttribute("x")).toBe("92");
    expect(hole?.getAttribute("width")).toBe("256");
  });
});

describe("small screens", () => {
  it("becomes a bottom sheet, drops the spotlight, and says which chapter it skipped", async () => {
    mobile = true;
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer();
    await render(makeBootstrap(server));
    await tick();
    expect(coach()?.className).toContain("tour-coach-sheet");
    expect(document.querySelector(".tour-scrim")).toBe(null);

    await act(async () => control("Continue").click());
    await tick();
    // `grid.resolve` is desktop-only, so the arc jumps to `live.publish` — and
    // a silently skipped chapter reads as a bug, so it is not silent.
    expect(server.state.stepId).toBe("live.publish");
    expect(coach()?.textContent).toContain("bigger screen");
  });

  it("resumes forwards, never back to the cold open, when the cursor names a dropped step", async () => {
    // The laptop player got to the desktop-only chapter; the phone cannot run
    // it. Falling back to the first step would show them Chapter 1 and then
    // write that restart over a server row that was ahead.
    mobile = true;
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({ chapter: "grid", stepId: "grid.resolve" });
    await render(makeBootstrap(server));
    await tick();

    expect(coach()?.textContent).toContain("Publish the agenda.");
    // The apology travels with the resolution instead of being stranded.
    expect(coach()?.textContent).toContain("bigger screen");
    expect(server.state.stepId).toBe("live.publish");
    expect(server.patches.every((patch) => patch.stepId !== "deck.look")).toBe(true);
  });
});

describe("arming a world objective", () => {
  it("moves and arms in one write, so the two cannot race each other", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer();
    await render(makeBootstrap(server));
    await tick();

    await act(async () => control("Continue").click());
    await tick();

    // Two writes would each carry a different `expectedStepId` against one
    // compare-and-set row; whichever lost would 409, and the recovery would
    // rewind the player a step and leave the objective unarmed.
    const entering = server.patches.filter((patch) => patch.stepId === "grid.resolve");
    expect(entering).toHaveLength(1);
    expect(entering[0]).toMatchObject({
      expectedStepId: "deck.look",
      armedStepId: "grid.resolve",
      armedBaseline: { conflictCount: 3 },
    });
  });
});

describe("resuming", () => {
  it("comes back on the step it was paused at, and navigates there", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({
      chapter: "live",
      stepId: "live.publish",
      status: "paused",
    });
    await render(makeBootstrap(server, {
      steps: STEPS.map((step) => (step.id === "live.publish" ? { ...step, route: { path: "/events/:eventId/agenda" } } : step)),
    }));
    await tick();
    expect(coach()).toBe(null);
    expect(document.querySelector(".tour-pill")?.textContent).toContain("Chapter 3 of 3 — Go live");

    await act(async () => control("Resume the tour").click());
    await tick();
    expect(server.state.status).toBe("active");
    expect(harness.push).toHaveBeenCalledWith("/events/evt-1/agenda");
    expect(coach()).not.toBe(null);
  });

  it("lets the player be done, and tells the host which way it ended", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer();
    const completed = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <GuidedTourMount bootstrap={makeBootstrap(server)} onComplete={completed} />,
    ));
    cleanup.push(async () => { await act(async () => root.unmount()); container.remove(); });
    await tick();

    await act(async () => control("Finish the tour for good").click());
    await tick();
    // Skipping is not a failure state, and the host still gets to retire the
    // ambient hints the player has now been personally shown.
    expect(completed).toHaveBeenCalledWith({ via: "skipped" });
    expect(server.state.status).toBe("complete");
    expect(coach()).toBe(null);
  });

  it("puts a side quest's skip back on the golden path instead of ending the tour", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer();
    await render(makeBootstrap(server, { steps: [...STEPS, QUEST_STEP] }));
    await tick();

    await act(async () => control("Read the mail you did not send.").click());
    await tick();
    expect(coach()?.textContent).toContain("Read the mail you did not send.");

    await act(async () => control("Skip this chapter").click());
    await tick();
    // Back where the arc was, tour still running, and no step of a chapter the
    // player never saw burned in the achievement log.
    expect(server.state.status).toBe("active");
    expect(server.state.stepId).toBe("deck.look");
    expect(server.records.filter((entry) => entry.outcome === "skipped").map((entry) => entry.stepId))
      .toEqual(["quest.outbox"]);
    expect(coach()).not.toBe(null);
  });

  it("renders nothing at all once the tour is complete", async () => {
    const server = makeServer({ status: "complete" });
    await render(makeBootstrap(server), <main id="page">Dashboard</main>);
    await tick();
    expect(coach()).toBe(null);
    expect(document.querySelector(".tour-pill")).toBe(null);
    expect(document.querySelector("#page")).not.toBe(null);
  });
});

/**
 * The mirror covers exactly one failure: a move this browser made whose PATCH
 * never landed. It is a record of what the player did, so it is adopted whole
 * — step *and* status — or not at all.
 */
describe("the optimistic mirror", () => {
  it("resumes the step whose write was lost", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    writeTourMirror("evt-1", { chapter: "live", stepId: "live.publish", status: "active" });

    await render(makeBootstrap(makeServer()));
    await tick();

    expect(coach()?.textContent).toContain("Publish the agenda.");
  });

  it("leaves the database in charge when the mirror is behind it", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    writeTourMirror("evt-1", { chapter: "deck", stepId: "deck.look", status: "active" });

    await render(makeBootstrap(makeServer({ chapter: "live", stepId: "live.publish" })));
    await tick();

    // Cross-device resume is the whole point: a laptop that got further wins.
    expect(coach()?.textContent).toContain("Publish the agenda.");
  });

  /**
   * The regression behind the demo ribbon's dead Reset and Delete buttons.
   * Forcing an adopted mirror back to `active` restarts a finished tutorial on
   * its last step — for the demo script that is the curtain call, a *modal*
   * `<dialog>`, which owns the top layer and leaves everything behind it
   * unclickable and absent from the accessibility tree, on every load.
   */
  it("does not restart a tour the mirror says the player finished", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    writeTourMirror("evt-1", { chapter: "live", stepId: "live.publish", status: "complete" });

    await render(makeBootstrap(makeServer()), <main id="page">Dashboard</main>);
    await tick();

    expect(coach()).toBe(null);
    expect(document.querySelector("dialog")).toBe(null);
    expect(document.querySelector("#page")).not.toBe(null);
  });

  it("comes back paused, not running, when that is where the player left it", async () => {
    writeTourMirror("evt-1", { chapter: "live", stepId: "live.publish", status: "paused" });

    await render(makeBootstrap(makeServer()));
    await tick();

    expect(coach()).toBe(null);
    expect(document.querySelector(".tour-pill")?.textContent).toContain("Chapter 3 of 3 — Go live");
  });

  it("ignores a mirror written by a version that stored a status this one does not know", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    window.localStorage.setItem(
      "openboard:tour:evt-1",
      JSON.stringify({ chapter: "live", stepId: "live.publish", status: "abandoned" }),
    );

    await render(makeBootstrap(makeServer()));
    await tick();

    // Unreadable mirror, database wins — never a fifth status.
    expect(coach()?.textContent).toContain("Everything that needs you, ranked.");
  });
});

/**
 * The end of the script, and the way back into a tour somebody moved from
 * outside the engine.
 *
 * Both were dead in a live run of the demo: the finale drew nothing, and the
 * ribbon's "Restart tour" wrote the row and changed nothing on screen — which
 * is the same bug twice, a layer that seeds its cursor once and then ignores
 * every later word from the server.
 */
const CURTAIN_STEP: TourStep = {
  id: "curtain.done", chapter: "live", kind: "beat", presentation: "modal-wide",
  title: "You just ran a conference.",
  body: "A form published. Decisions queued. And zero emails to eighteen people who do not exist.",
  route: { path: "/events/:eventId/dashboard" },
  action: { label: "Create my real event", href: "/organizations/:organizationId/onboarding?mode=create" },
  continueLabel: "Keep playing in the demo",
  reward: { emoji: "🎉", line: "Nothing in here is read-only. Rename it, break it, delete it." },
};

const FINALE_CONTEXT = { eventId: "evt-1", organizationId: "org-1", slug: "worlds-fair-demo" };

describe("the curtain call", () => {
  beforeEach(() => {
    // happy-dom ships `<dialog>` without the top layer; the tour's two modal
    // beats are the only steps that need it.
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
    }
  });

  it("draws itself wherever the player is standing, with what they did and the way out", async () => {
    // Deliberately not on the step's own route. The finale has no anchor and
    // no objective, so a cursor sitting on it must produce a card on whatever
    // page the last chapter happened to end on — the alternative is a tour
    // that has visibly stopped existing.
    harness.pathname = "/events/evt-1/communications";
    const server = makeServer({
      chapter: "live", stepId: "curtain.done", status: "active",
      completed: ["deck.look", "grid.resolve"],
    });
    await render(makeBootstrap(server, {
      steps: [...STEPS, QUEST_STEP, CURTAIN_STEP],
      completed: ["deck.look", "grid.resolve"],
      context: FINALE_CONTEXT,
    }));
    await tick();

    const dialog = document.querySelector("dialog[open]");
    expect(dialog?.textContent).toContain("You just ran a conference.");
    // The recap is the argument. A curtain call that asserts an achievement
    // and shows no evidence for it is a compliment, not a finale.
    expect(dialog?.textContent).toContain("2 of 4 objectives");
    expect(dialog?.textContent).toContain("0 of 1 side quests");
    expect(dialog?.textContent).toContain("Nothing in here is read-only.");

    // The hand-off, at the moment of maximum intent — and through the script's
    // own `:token` context, not a literal colon in the address bar.
    await act(async () => control("Create my real event").click());
    expect(harness.push).toHaveBeenCalledWith("/organizations/org-1/onboarding?mode=create");
  });

  it("comes back when the host restarts the tour from outside the engine", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const steps = [...STEPS, CURTAIN_STEP];
    const server = makeServer({ chapter: "live", stepId: "curtain.done", status: "complete" });
    const reported: Array<{ status: string; stepId: string }> = [];
    const onStatusChange = (status: string, cursor: { stepId: string }) => reported.push({ status, stepId: cursor.stepId });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <GuidedTourMount bootstrap={makeBootstrap(server, { steps })} onStatusChange={onStatusChange} />,
    ));
    cleanup.push(async () => { await act(async () => root.unmount()); container.remove(); });
    await tick();
    expect(coach()).toBe(null);
    expect(document.querySelector("dialog[open]")).toBe(null);

    // Exactly what the demo ribbon's "Restart tour" does: write the row, then
    // hand the page a fresh server render. Before this, the layer kept the
    // cursor it mounted with — so the restart moved the database and nothing
    // else, and the button read as broken.
    server.state = { ...server.state, chapter: "deck", stepId: "deck.look", status: "active" };
    await act(async () => root.render(
      <GuidedTourMount bootstrap={makeBootstrap(server, { steps })} onStatusChange={onStatusChange} />,
    ));
    await tick();

    expect(coach()?.textContent).toContain("Everything that needs you, ranked.");
    expect(coach()?.textContent).toContain("Chapter 1 of 3 — Command deck");
    // And the host hears about it, so its own resume surfaces stop describing
    // a tour that ended.
    expect(reported.at(-1)).toEqual({ status: "active", stepId: "deck.look" });
  });

  it("stands on the next unfinished objective when the cursor names a step this build lost", async () => {
    document.body.insertAdjacentHTML("beforeend", '<nav class="dashboard-tabs">Today</nav>');
    const server = makeServer({ chapter: "grid", stepId: "grid.renamed-in-m62", completed: ["deck.look"] });
    await render(makeBootstrap(server, { completed: ["deck.look"] }));
    await tick();

    // Not the cold open: the resolution is written back to the row, so
    // restarting here would erase the chapters the organizer had finished.
    expect(coach()?.textContent).toContain("Fix it.");
    expect(server.state.stepId).toBe("grid.resolve");
  });
});
