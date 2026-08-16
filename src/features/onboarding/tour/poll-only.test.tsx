/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TourBootstrap, TourStateWire, TourStep, TourTransport, TourWorld } from "@/shared/ui/app/guided-tour";
import { tourWorldSchema } from "../tour-schemas";
import { TOUR_CHAPTERS, TOUR_STEPS } from "./script";

/**
 * The whole golden path, completed with the signal bus dead.
 *
 * `emitTourSignal` shaves a poll interval off the two most-pressed objectives
 * and is **never** the authority. This test is the proof: it drives every
 * required step of the real script with nothing ever emitting a signal, and
 * asserts the tour still reaches its curtain call. Delete either call site and
 * the tutorial gets two seconds slower; nothing else changes.
 *
 * It doubles as the script's integration check. Because it walks the steps in
 * order and moves the browser to each step's own route before looking, a step
 * whose objective is already true on arrival shows up here as a chapter the
 * organizer never got to read.
 */

const harness = vi.hoisted(() => ({
  pathname: "/events/evt-1/dashboard",
  search: "",
  emit: vi.fn(),
  push: vi.fn<(href: string) => void>(),
  toast: vi.fn(),
  rain: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => harness.pathname,
  useSearchParams: () => new URLSearchParams(harness.search),
  useRouter: () => ({ push: harness.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/shared/ui/emoji-rain", () => ({ emojiRain: harness.rain }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action(), allowNextNavigation: (action?: () => void) => action?.() }),
}));
// The bus exists and is wired up; nothing ever rings it.
vi.mock("@/shared/ui/app/guided-tour/signals", () => ({
  emitTourSignal: harness.emit,
  onTourSignal: () => () => undefined,
}));

const { GuidedTourMount } = await import("@/shared/ui/app/guided-tour");

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: Readonly<Record<string, string>> = {
  eventId: "evt-1",
  eventSlug: "ai-engineer-worlds-fair-demo-a1b2c3d4",
  cfpFormId: "form-a",
  organizationId: "org-1",
};

const START_WORLD: TourWorld = tourWorldSchema.parse({
  formFields: 11, formVersions: 2, submissionsTotal: 24, pendingCount: 5, acceptedCount: 8,
  reviewsByMe: 0, decisionEmailsQueued: 0, sessionsScheduled: 17, conflictCount: 2,
  publishedSessions: 0, embedEnabled: false, templateUpdatedAt: "2026-08-01T00:00:00.000Z",
  portalTaskCompletions: 0, resourcePagesPublished: 2, contactsUpdatedAt: "2026-08-01T00:00:00.000Z",
}) as TourWorld;

type Server = {
  state: TourStateWire;
  transport: TourTransport;
  records: Array<{ stepId: string; outcome: string }>;
};

function makeServer(): Server {
  const server: Server = {
    state: {
      chapter: TOUR_STEPS[0]?.chapter ?? "cold-open",
      stepId: TOUR_STEPS[0]?.id ?? "coldopen.hello",
      status: "not_started",
      armedStepId: null,
      armedBaseline: null,
      completed: [],
      questsDone: [],
      world: { ...START_WORLD },
    },
    records: [],
    transport: {
      read: async () => ({ ...server.state }),
      patch: async (patch) => {
        server.state = {
          ...server.state,
          chapter: patch.chapter,
          stepId: patch.stepId,
          status: patch.status,
          armedStepId: patch.armedStepId ?? null,
          armedBaseline: patch.armedBaseline ?? null,
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

function bootstrapFor(server: Server): TourBootstrap {
  return {
    scopeId: "evt-1",
    statePath: "events/evt-1/tour",
    stepsPath: "events/evt-1/tour/steps",
    transport: server.transport,
    chapters: TOUR_CHAPTERS,
    steps: TOUR_STEPS,
    cursor: { chapter: server.state.chapter, stepId: server.state.stepId, status: server.state.status },
    completed: [],
    questsDone: [],
    world: server.state.world,
    context: CONTEXT,
  };
}

/* --- driving ------------------------------------------------------------ */

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;
/** Stands in for the admin content region the real page renders into. */
let page: HTMLDivElement | null = null;
let mounted: TourBootstrap | null = null;

async function tick(ms = 0) {
  if (ms <= 0) {
    await act(async () => { await Promise.resolve(); });
    return;
  }
  for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(5_000, ms - elapsed)); });
  }
}

/**
 * Re-renders so the mocked `usePathname`/`useSearchParams` are read again.
 *
 * A fresh element every time on purpose: React bails out of a render whose
 * element is referentially identical, and the whole point here is to make the
 * engine look at the location again.
 */
async function rerender() {
  const bootstrap = mounted;
  if (!root || !bootstrap) return;
  await act(async () => root?.render(<GuidedTourMount bootstrap={bootstrap} />));
}

function goTo(path: string, query: Readonly<Record<string, string>> = {}) {
  harness.pathname = path.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, (whole, key: string) => CONTEXT[key] ?? whole);
  const entries = Object.entries(query).map(([key, value]) => [key, value.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, (whole, token: string) => CONTEXT[token] ?? whole)] as const);
  harness.search = new URLSearchParams(entries.map(([key, value]) => [key, value])).toString();
}

/**
 * Renders something the step's anchor can actually resolve to.
 *
 * The tour points at other people's UI, so the fixture has to supply it. Doing
 * that per step also proves every anchor spec in the script is reachable by
 * the engine's own resolver — a `role` anchor whose name never matches, or a
 * selector nobody renders, shows up here as a spotlight over nothing.
 */
function mountAnchor(spec: TourStep["anchor"]) {
  if (!spec || spec.kind === "none" || !page) return;
  const node = document.createElement("div");
  if (spec.kind === "tour-id") node.setAttribute("data-tour", spec.id);
  else if (spec.kind === "selector" && spec.css.startsWith("#")) node.id = spec.css.slice(1);
  else if (spec.kind === "selector") node.className = spec.css.replace(/^\./u, "");
  else {
    node.setAttribute("role", spec.role);
    node.setAttribute("aria-label", spec.name);
  }
  page.append(node);
}

function control(label: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  ) ?? null;
}

function advanceControlFor(step: TourStep): HTMLElement | null {
  return control(step.continueLabel ?? (step.kind === "observe" ? "Got it" : "Continue"));
}

async function click(node: HTMLElement) {
  await act(async () => { node.click(); });
}

/* --- the walk ----------------------------------------------------------- */

/** Moves the world the way `step` asks. The one thing a real organizer does. */
function satisfyWorld(server: Server, fact: string, delta: "increased" | "decreased" | "changed") {
  const before = server.state.world[fact];
  const after = typeof before === "number"
    ? (delta === "decreased" ? before - 1 : before + 1)
    : typeof before === "boolean"
      ? !before
      : "2026-09-09T09:09:00.000Z";
  server.state = { ...server.state, world: { ...server.state.world, [fact]: after } };
}

describe("the golden path completes on polling alone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.pathname = "/events/evt-1/dashboard";
    harness.search = "";
    harness.emit.mockClear();
    harness.push.mockClear();
    harness.toast.mockClear();
    harness.rain.mockClear();
    window.localStorage.clear();
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
    }
    // happy-dom ships an inert IntersectionObserver, and every `observe` step
    // waits on one. The fixture gives it the browser's behaviour: a connected
    // target is on screen, a detached one is not.
    class TestIntersectionObserver {
      constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) {}
      observe(target: Element) { this.callback([{ isIntersecting: target.isConnected, target }]); }
      unobserve() { /* nothing to forget */ }
      disconnect() { /* nothing to forget */ }
      takeRecords() { return []; }
    }
    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, writable: true, value: TestIntersectionObserver });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        media: query, matches: false, onchange: null,
        addEventListener: () => undefined, removeEventListener: () => undefined,
        addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
      }),
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    page?.remove();
    root = null;
    container = null;
    page = null;
    mounted = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("walks every required step to the curtain call with the signal bus dead", async () => {
    const server = makeServer();
    page = document.createElement("div");
    page.id = "admin-content";
    container = document.createElement("div");
    document.body.append(page, container);
    mounted = bootstrapFor(server);
    root = createRoot(container);
    await rerender();
    await tick();

    const arc = TOUR_STEPS.filter((step) => step.optional !== true);
    const visited: string[] = [];

    for (const step of arc) {
      // Leaving a page unmounts whatever was on it. Doing that here matters:
      // the engine holds the last anchor it resolved, and a marker left lying
      // around from the previous chapter would keep answering for this one.
      if (page) page.replaceChildren();
      // …except the one the step is waiting to see appear.
      const domTarget = step.objective?.via === "dom" ? step.objective.present : null;
      if (!(step.anchor?.kind === "tour-id" && step.anchor.id === domTarget)) mountAnchor(step.anchor);
      // The engine navigates through the mocked router, so the test plays the
      // browser: put the location where the step asked before looking at it.
      if (step.route) {
        goTo(step.route.path, step.route.query ?? {});
        await rerender();
      }
      await tick();
      expect(server.state.stepId, `stalled before ${step.id}`).toBe(step.id);
      visited.push(step.id);

      const objective = step.objective;
      if (objective?.via === "world") {
        // Let the step arm and persist its baseline first: a world that moved
        // before the arm is invisible, which is the bug the persisted baseline
        // exists to prevent.
        await tick(50);
        satisfyWorld(server, objective.fact, objective.delta);
        await tick(4_000);
      } else if (objective?.via === "route") {
        goTo(objective.path, objective.query ?? {});
        await rerender();
        await tick();
      } else if (objective?.via === "dom") {
        const marker = document.createElement("div");
        marker.setAttribute("data-tour", objective.present);
        page?.append(marker);
        await tick(100);
      } else if (objective?.via === "self") {
        // The card owns the control, so the card is what the player presses.
        // Nothing else can observe it: the trip is to a different document.
        const action = step.action;
        const button = action ? control(action.label) : null;
        expect(button, `${step.id} declared via:"self" with no action button`).not.toBeNull();
        if (button) await click(button);
        await tick(100);
      } else {
        // A beat or an observe: read it, then press the one button it offers.
        await tick(2_000);
        const button = advanceControlFor(step);
        expect(button, `${step.id} offered no way forward`).not.toBeNull();
        if (button) await click(button);
        await tick();
      }
      // Nothing advances on its own any more. An `act` step whose objective has
      // just been met says so and then waits: the player reads what they did
      // and presses Next, which is the whole difference between a tutorial and
      // a card that congratulates you and vanishes mid-sentence.
      if (objective) {
        const next = control("Next");
        expect(next, `${step.id} met its objective and offered no Next`).not.toBeNull();
        if (next) await click(next);
      }
      await tick(2_000);
    }

    expect(visited).toEqual(arc.map((step) => step.id));
    expect(server.state.status).toBe("complete");
    // Every objective recorded, and not one of them via a client signal.
    expect(server.records.filter((entry) => entry.outcome === "completed")).toHaveLength(arc.length);
    expect(harness.emit).not.toHaveBeenCalled();
  });
});
