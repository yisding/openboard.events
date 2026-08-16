import { describe, expect, it } from "vitest";
import {
  objectiveSatisfied,
  resolveTourPath,
  type ObjectiveContext,
  type TourLocation,
  type TourObjective,
  type TourWorld,
} from "@/shared/ui/app/guided-tour";
import { WORLD_FACT_KEYS, tourWorldSchema } from "../tour-schemas";
import { TOUR_CONTEXT_KEYS, TOUR_STEPS } from "./script";

/**
 * Every objective in the script, driven against the engine's own predicates.
 *
 * `script.test.ts` checks the script's shape; this checks that each objective
 * can actually be *reached*. Two failure modes it exists to catch, both of
 * which look identical to the organizer — a card that never completes:
 *
 *   - an objective that is already true the moment its step arms, so the card
 *     flashes past before anybody reads it;
 *   - an objective that names a fact the server does not compute, or asks a
 *     counter to move in the direction the product never moves it.
 */

const CONTEXT: Readonly<Record<string, string>> = {
  eventId: "11111111-1111-4111-8111-111111111111",
  eventSlug: "ai-engineer-worlds-fair-demo-a1b2c3d4",
  cfpFormId: "22222222-2222-4222-8222-222222222222",
  editableFormId: "44444444-4444-4444-8444-444444444444",
  organizationId: "33333333-3333-4333-8333-333333333333",
};

/** A world where nothing has happened yet — the baseline every act arms against. */
const QUIET_WORLD: TourWorld = tourWorldSchema.parse({
  formFields: 11, formVersions: 2, submissionsTotal: 24, pendingCount: 5, acceptedCount: 8,
  reviewsByMe: 0, decisionEmailsQueued: 0, sessionsScheduled: 17, conflictCount: 2,
  publishedSessions: 0, embedEnabled: false, templateUpdatedAt: "2026-08-01T00:00:00.000Z",
  portalTaskCompletions: 0, resourcePagesPublished: 2, contactsUpdatedAt: "2026-08-01T00:00:00.000Z",
});

const NOWHERE: TourLocation = { pathname: "/events/x/dashboard", query: {} };

function context(overrides: Partial<ObjectiveContext> = {}): ObjectiveContext {
  return {
    location: NOWHERE,
    routeContext: CONTEXT,
    world: QUIET_WORLD,
    baseline: QUIET_WORLD,
    domPresent: false,
    selfDone: false,
    ...overrides,
  };
}

function locationFor(objective: Extract<TourObjective, { via: "route" }>): TourLocation {
  const query = Object.fromEntries(
    Object.entries(objective.query ?? {}).map(([key, value]) => [key, resolveTourPath(value, CONTEXT)]),
  );
  return { pathname: resolveTourPath(objective.path, CONTEXT), query };
}

/** Nudge one fact the way its step asks, leaving everything else alone. */
function moved(world: TourWorld, fact: string, delta: "increased" | "decreased" | "changed"): TourWorld {
  const before = world[fact as keyof TourWorld];
  if (typeof before === "number") return { ...world, [fact]: delta === "decreased" ? before - 1 : before + 1 };
  if (typeof before === "boolean") return { ...world, [fact]: !before };
  return { ...world, [fact]: "2026-08-02T00:00:00.000Z" };
}

const ACTS = TOUR_STEPS.filter((step) => step.kind === "act");

describe("guided tour objectives", () => {
  it("only names world facts the server actually computes", () => {
    for (const step of ACTS) {
      if (step.objective?.via !== "world") continue;
      expect(WORLD_FACT_KEYS as readonly string[], step.id).toContain(step.objective.fact);
    }
  });

  it("leaves every act unsatisfied at the moment it arms", () => {
    // The arming state: the player is wherever the step's route sent them, the
    // world is exactly what the baseline captured, nothing is mounted, nothing
    // has been clicked. Every one of these must read "not done yet".
    for (const step of ACTS) {
      const location = step.route
        ? {
            pathname: resolveTourPath(step.route.path, CONTEXT),
            query: Object.fromEntries(
              Object.entries(step.route.query ?? {}).map(([key, value]) => [key, resolveTourPath(value, CONTEXT)]),
            ),
          }
        : NOWHERE;
      expect(objectiveSatisfied(step.objective, context({ location })), step.id).toBe(false);
    }
  });

  it("satisfies every world objective when its fact moves the way it asked", () => {
    for (const step of ACTS) {
      if (step.objective?.via !== "world") continue;
      const { fact, delta } = step.objective;
      const after = moved(QUIET_WORLD, fact, delta);
      expect(objectiveSatisfied(step.objective, context({ world: after })), step.id).toBe(true);
      if (delta === "changed") continue;
      // …and not when it moves the other way. A counter that only ever grows
      // would make `decreased` unreachable, which is exactly the mistake
      // "move to accept queue increases acceptedCount" would have been.
      const wrongWay = moved(QUIET_WORLD, fact, delta === "increased" ? "decreased" : "increased");
      expect(objectiveSatisfied(step.objective, context({ world: wrongWay })), `${step.id} backwards`).toBe(false);
    }
  });

  it("satisfies every route objective at its own destination, extra filters and all", () => {
    for (const step of ACTS) {
      if (step.objective?.via !== "route") continue;
      const location = locationFor(step.objective);
      expect(objectiveSatisfied(step.objective, context({ location })), step.id).toBe(true);
      // A filter the organizer added themselves, or the one-shot `arm=1` the
      // deep links carry, must not un-complete a step they already finished.
      const noisy: TourLocation = { pathname: location.pathname, query: { ...location.query, arm: "1", page: "2" } };
      expect(objectiveSatisfied(step.objective, context({ location: noisy })), `${step.id} with extra query`).toBe(true);
      // A different event's identical path must not.
      const elsewhere: TourLocation = { pathname: `${location.pathname}/nested`, query: location.query };
      expect(objectiveSatisfied(step.objective, context({ location: elsewhere })), `${step.id} elsewhere`).toBe(false);
    }
  });

  it("satisfies the dom and self objectives on their own evidence", () => {
    for (const step of ACTS) {
      if (step.objective?.via === "dom") {
        expect(objectiveSatisfied(step.objective, context({ domPresent: true })), step.id).toBe(true);
      }
      if (step.objective?.via === "self") {
        expect(objectiveSatisfied(step.objective, context({ selfDone: true })), step.id).toBe(true);
      }
    }
  });

  it("resolves every route token from the context the host supplies", () => {
    for (const step of TOUR_STEPS) {
      for (const route of [step.route, step.objective?.via === "route" ? step.objective : null]) {
        if (!route) continue;
        const resolved = [route.path, ...Object.values(route.query ?? {})].map((part) => resolveTourPath(part, CONTEXT));
        for (const part of resolved) expect(part, `${step.id}: ${part}`).not.toContain(":");
      }
    }
    // And the context this test uses is the contract the script declares.
    expect(Object.keys(CONTEXT).sort()).toEqual([...TOUR_CONTEXT_KEYS].sort());
  });
});
