import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { PATCH as patchTour } from "../../app/api/internal/events/[eventId]/tour/route";
import { POST as postTourStep } from "../../app/api/internal/events/[eventId]/tour/steps/route";
import { tourCursorPatchSchema, tourStepRecordSchema } from "./tour-schemas";

const eventId = "f7000000-0000-4000-8000-000000000011";
const routeSource = readFileSync(
  new URL("../../app/api/internal/events/[eventId]/tour/route.ts", import.meta.url),
  "utf8",
);
const stepsRouteSource = readFileSync(
  new URL("../../app/api/internal/events/[eventId]/tour/steps/route.ts", import.meta.url),
  "utf8",
);

/**
 * The tour's HTTP boundary. The interesting behaviour lives in
 * `server/tour.ts` and is exercised against a real database there; what these
 * assertions protect is the boundary itself — the guard, the scope, the poll
 * budget and the schemas — which a refactor can quietly weaken without any
 * test of the writers noticing.
 */
describe("guided tour routes", () => {
  it("is organizer-only and scoped to the event in the URL, on every verb", () => {
    expect(routeSource).toContain('adminAuth({ role: "organizer" })');
    expect(stepsRouteSource).toContain('adminAuth({ role: "organizer" })');
    // The event comes from the path, never from the body: `defineHandler`
    // parses `params.eventId` and hands it to the guard, so a cross-tenant id
    // in a payload has nothing to bind to.
    expect(routeSource).toContain("eventIdSchema.parse(eventId)");
    expect(stepsRouteSource).toContain("eventIdSchema.parse(eventId)");
    expect(routeSource).not.toContain("eventAuth");
  });

  it("budgets the poll so a tutorial cannot become a load generator", () => {
    expect(routeSource).toContain("limit: 400");
    expect(routeSource).toContain("windowMs: 5 * 60 * 1000");
    expect(routeSource).toContain("`tour-state:${eventId ?? \"unknown\"}`");
  });

  it("rejects a cross-site cursor write before it touches anything", async () => {
    const response = await patchTour(
      new NextRequest(`https://example.test/api/internal/events/${eventId}/tour`, {
        method: "PATCH",
        headers: { origin: "https://evil.test" },
        body: JSON.stringify({ expectedStepId: "coldopen.hello", chapter: "cold-open", stepId: "x", status: "active" }),
      }),
      { params: Promise.resolve({ eventId }) },
    );
    expect(response.status).toBe(403);
  });

  it("rejects a cross-site achievement write too", async () => {
    const response = await postTourStep(
      new NextRequest(`https://example.test/api/internal/events/${eventId}/tour/steps`, {
        method: "POST",
        headers: { origin: "https://evil.test" },
        body: JSON.stringify({ stepId: "forms.publish" }),
      }),
      { params: Promise.resolve({ eventId }) },
    );
    expect(response.status).toBe(403);
  });

  describe("the cursor payload", () => {
    const valid = {
      expectedStepId: "coldopen.hello",
      chapter: "cold-open",
      stepId: "dashboard.attention",
      status: "active",
    };

    it("always names the step it believes it is leaving", () => {
      expect(tourCursorPatchSchema.safeParse(valid).success).toBe(true);
      expect(tourCursorPatchSchema.safeParse({ ...valid, expectedStepId: undefined }).success).toBe(false);
    });

    it("refuses a baseline with no step to pin it to", () => {
      expect(tourCursorPatchSchema.safeParse({ ...valid, armedBaseline: { conflictCount: 3 } }).success).toBe(false);
      expect(tourCursorPatchSchema.safeParse({
        ...valid,
        armedStepId: "agenda.resolve-conflict",
        armedBaseline: { conflictCount: 3 },
      }).success).toBe(true);
    });

    it("refuses a baseline naming a fact the world does not report", () => {
      expect(tourCursorPatchSchema.safeParse({
        ...valid,
        armedStepId: "agenda.resolve-conflict",
        armedBaseline: { conflictsWeInvented: 3 },
      }).success).toBe(false);
    });

    it("keeps identifiers to a shape that is safe to store, log and render", () => {
      for (const stepId of ["<script>", "Dashboard Attention", "", "a".repeat(200)]) {
        expect(tourCursorPatchSchema.safeParse({ ...valid, stepId }).success).toBe(false);
      }
      expect(tourCursorPatchSchema.safeParse({ ...valid, status: "finished" }).success).toBe(false);
    });
  });

  it("records a completed objective unless the payload says otherwise", () => {
    expect(tourStepRecordSchema.parse({ stepId: "forms.publish" }).outcome).toBe("completed");
    expect(tourStepRecordSchema.parse({ stepId: "forms.publish", outcome: "skipped" }).outcome).toBe("skipped");
    expect(tourStepRecordSchema.safeParse({ stepId: "forms.publish", outcome: "abandoned" }).success).toBe(false);
  });
});
