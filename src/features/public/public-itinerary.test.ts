import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PUBLISHED_SCHEDULE_FIXTURE } from "@/shared/fixtures/sessions";
import { itineraryStorageKey } from "./itinerary-storage";
import { myScheduleEmptyCopy, PublicItinerary } from "./public-itinerary";

const hookHarness = vi.hoisted(() => ({
  enabled: false,
  cursor: 0,
  states: [] as unknown[],
  setters: [] as Array<(value: unknown | ((current: unknown) => unknown)) => void>,
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState<T>(initialState: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>] {
      if (!hookHarness.enabled) return actual.useState(initialState);
      const index = hookHarness.cursor;
      hookHarness.cursor += 1;
      if (!(index in hookHarness.states)) {
        hookHarness.states[index] = typeof initialState === "function"
          ? (initialState as () => T)()
          : initialState;
      }
      const setState: React.Dispatch<React.SetStateAction<T>> = (value) => {
        const current = hookHarness.states[index] as T;
        hookHarness.states[index] = typeof value === "function"
          ? (value as (previous: T) => T)(current)
          : value;
      };
      hookHarness.setters[index] = setState as (value: unknown | ((current: unknown) => unknown)) => void;
      return [hookHarness.states[index] as T, setState];
    },
    useMemo<T>(factory: () => T, dependencies: React.DependencyList): T {
      return hookHarness.enabled ? factory() : actual.useMemo(factory, dependencies);
    },
    useEffect(effect: React.EffectCallback, dependencies?: React.DependencyList): void {
      if (hookHarness.enabled) {
        hookHarness.effects.push(effect);
        return;
      }
      actual.useEffect(effect, dependencies);
    },
  };
});

Object.assign(globalThis, { React });

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function renderWithHookHarness(props: React.ComponentProps<typeof PublicItinerary>): string {
  hookHarness.cursor = 0;
  hookHarness.effects = [];
  return renderToStaticMarkup(React.createElement(PublicItinerary, props));
}

function startHookHarness(): void {
  hookHarness.enabled = true;
  hookHarness.cursor = 0;
  hookHarness.states = [];
  hookHarness.setters = [];
  hookHarness.effects = [];
}

function stopHookHarness(): void {
  hookHarness.enabled = false;
  hookHarness.cursor = 0;
  hookHarness.states = [];
  hookHarness.setters = [];
  hookHarness.effects = [];
  Reflect.deleteProperty(globalThis, "window");
}

// Most cases below prove the server-rendered shell. The final interaction case
// uses the hook harness above to execute the actual component's hydration
// effect and state transitions without adding a browser DOM dependency to the
// node-based Vitest suite. Storage reconciliation itself remains covered in
// `itinerary-storage.test.ts`.
describe("PublicItinerary", () => {
  it("distinguishes no stars from stars hidden by embed filters", () => {
    expect(myScheduleEmptyCopy(0)).toMatchObject({
      title: "No starred sessions yet",
      hiddenByEmbed: false,
    });
    expect(myScheduleEmptyCopy(2)).toMatchObject({
      title: "Your starred sessions are outside this embed",
      hiddenByEmbed: true,
    });
  });

  it("renders every published session with a star toggle and the My Schedule control", () => {
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
    }));

    expect(html).toContain("Agents");
    expect(html).toContain("My Schedule");
    expect(html).toContain("itinerary-star");
  });

  it("starts with the export disabled (nothing starred pre-hydration)", () => {
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
    }));

    expect(html).toContain("Star sessions to export");
    expect(html).not.toContain("/schedule/ics?session=");
  });

  it("shows the coming-soon empty state when the event has no published sessions", () => {
    const empty = { ...PUBLISHED_SCHEDULE_FIXTURE, days: [], sessions: [] };
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, { eventSlug: "openboard-summit", schedule: empty }));

    expect(html).toContain("Schedule coming soon");
  });

  it("distinguishes configured filters with no matches from an unpublished schedule", () => {
    const html = renderToStaticMarkup(React.createElement(PublicItinerary, {
      eventSlug: "openboard-summit",
      schedule: PUBLISHED_SCHEDULE_FIXTURE,
      filters: { trackIds: ["00000000-0000-4000-8000-000000000999"] },
    }));

    expect(html).toContain("No itinerary sessions match this embed");
    expect(html).not.toContain("Schedule coming soon");
  });

  it("hydrates stored stars through PublicItinerary and preserves both empty-state recovery controls", () => {
    const eventSlug = "openboard-summit";
    const session = PUBLISHED_SCHEDULE_FIXTURE.sessions[0];
    if (!session) throw new Error("Expected the schedule fixture to contain a session");
    const storage = memoryStorage();
    storage.setItem(itineraryStorageKey(eventSlug), JSON.stringify([session.id]));
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
    startHookHarness();

    try {
      const hiddenByEmbedProps: React.ComponentProps<typeof PublicItinerary> = {
        eventSlug,
        schedule: PUBLISHED_SCHEDULE_FIXTURE,
        filters: { trackIds: ["00000000-0000-4000-8000-000000000999"] },
      };
      renderWithHookHarness(hiddenByEmbedProps);
      expect(hookHarness.effects[0]).toBeDefined();
      hookHarness.effects[0]?.();
      const hydrated = renderWithHookHarness(hiddenByEmbedProps);

      expect(hydrated).toContain("Your starred sessions are outside this embed");
      expect(hydrated).toContain('href="/e/openboard-summit/itinerary"');
      expect(hydrated).toContain("Open the full itinerary");

      // Reset the real component's hook state with empty storage, hydrate, then
      // exercise the My Schedule toggle's own state transition. With published
      // sessions available but none starred, its empty state must still offer
      // the reversible Browse control rather than strand the visitor.
      storage.clear();
      startHookHarness();
      const unfilteredProps: React.ComponentProps<typeof PublicItinerary> = {
        eventSlug,
        schedule: PUBLISHED_SCHEDULE_FIXTURE,
      };
      renderWithHookHarness(unfilteredProps);
      hookHarness.effects[0]?.();
      hookHarness.setters[2]?.((current: unknown) => !current);
      const myScheduleEmpty = renderWithHookHarness(unfilteredProps);

      expect(myScheduleEmpty).toMatch(/<button type="button">Browse sessions in this embed<\/button>/);
      hookHarness.setters[2]?.(false);
      const browsing = renderWithHookHarness(unfilteredProps);
      expect(browsing).toContain("Agents");
      expect(browsing).not.toContain("Browse sessions in this embed");
    } finally {
      stopHookHarness();
    }
  });
});
