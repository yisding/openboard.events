import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { DELETE as deleteDemo, POST as postDemo } from "../../app/api/internal/organizations/[organizationId]/demo/route";
import {
  DEMO_PHASE_COUNT,
  DEMO_PHASE_LABELS,
  DEMO_RUNNABLE_PHASES,
  demoDeleteRequestSchema,
  demoProvisionRequestSchema,
  demoProvisionStateSchema,
} from "./demo-schemas";
import { DEMO_PROVISION_PHASES } from "./tour-schemas";

const organizationId = "b7000000-0000-4000-8000-000000000021";
const routeSource = readFileSync(
  new URL("../../app/api/internal/organizations/[organizationId]/demo/route.ts", import.meta.url),
  "utf8",
);

/**
 * The demo provisioner's HTTP boundary. The behaviour lives in
 * `server/demo/provisioning.ts` and is exercised against a real database
 * there; what these assertions protect is the boundary — the guard, the tenant
 * scope, the write budget and the payload shapes — which a refactor can
 * weaken without any test of the writers noticing.
 */
describe("the demo provisioning route", () => {
  it("authorizes against the organization in the URL, and gates the delete on ownership", () => {
    expect(routeSource).toContain("auth: organizationAuth(),");
    expect(routeSource).toContain('auth: organizationAuth({ role: "owner" })');
    // The tenant comes from the path, never from a body: a cross-tenant id in
    // a payload has nothing to bind to.
    expect(routeSource).toContain("requireOrganizationId(params)");
  });

  it("budgets the provisioning loop so it cannot be used as a write amplifier", () => {
    // Ten phases, plus room to retry every one of them and reset twice.
    expect(routeSource).toContain("limit: 40");
    expect(routeSource).toContain("windowMs: 5 * 60 * 1000");
    expect(routeSource).toContain("demo-provision:");
  });

  it("rejects a cross-site provision before it touches anything", async () => {
    const response = await postDemo(
      new NextRequest(`https://example.test/api/internal/organizations/${organizationId}/demo`, {
        method: "POST",
        headers: { origin: "https://evil.test" },
        body: JSON.stringify({ mode: "provision" }),
      }),
      { params: Promise.resolve({ organizationId }) },
    );
    expect(response.status).toBe(403);
  });

  it("rejects a cross-site delete too", async () => {
    const response = await deleteDemo(
      new NextRequest(`https://example.test/api/internal/organizations/${organizationId}/demo`, {
        method: "DELETE",
        headers: { origin: "https://evil.test" },
        body: JSON.stringify({ confirm: "DELETE" }),
      }),
      { params: Promise.resolve({ organizationId }) },
    );
    expect(response.status).toBe(403);
  });

  describe("the request payloads", () => {
    it("provisions by default, so a bodyless retry from the progress screen still works", () => {
      expect(demoProvisionRequestSchema.parse({})).toEqual({ mode: "provision" });
    });

    it("accepts only the three modes the screen can actually ask for", () => {
      for (const mode of ["provision", "reset", "skip"]) {
        expect(demoProvisionRequestSchema.safeParse({ mode }).success).toBe(true);
      }
      expect(demoProvisionRequestSchema.safeParse({ mode: "delete" }).success).toBe(false);
    });

    it("will not delete anything without the typed confirmation", () => {
      expect(demoDeleteRequestSchema.safeParse({ confirm: "DELETE" }).success).toBe(true);
      expect(demoDeleteRequestSchema.safeParse({ confirm: "delete" }).success).toBe(false);
      expect(demoDeleteRequestSchema.safeParse({}).success).toBe(false);
    });

    it("carries no way to ask for a demo flag on anything else", () => {
      expect(Object.keys(demoProvisionRequestSchema.shape)).toEqual(["mode"]);
    });
  });

  describe("the state the screen renders", () => {
    it("counts the ten phases the orchestrator actually runs", () => {
      expect(DEMO_PHASE_COUNT).toBe(10);
      // `ready` and `failed` are cursor values, not phases; everything else in
      // the migration's CHECK has a runner.
      expect([...DEMO_RUNNABLE_PHASES, "ready", "failed"].sort()).toEqual([...DEMO_PROVISION_PHASES].sort());
    });

    it("has a line of narration for every phase, so the copy cannot drift from the work", () => {
      for (const phase of DEMO_PROVISION_PHASES) {
        expect(DEMO_PHASE_LABELS[phase].length).toBeGreaterThan(0);
      }
      // The repo bans this phrase in user-facing copy; failure copy here has to
      // say what to do instead.
      expect(Object.values(DEMO_PHASE_LABELS).join(" ")).not.toContain("Something went wrong");
    });

    it("describes a phase as 1-based so '7 of 10' reads the way a human counts", () => {
      const parsed = demoProvisionStateSchema.parse({
        eventId: "c7000000-0000-4000-8000-000000000031",
        eventSlug: "ai-engineer-worlds-fair-demo-c7000000",
        phase: "agenda",
        phaseIndex: 7,
        phaseCount: 10,
        label: DEMO_PHASE_LABELS.agenda,
        done: false,
      });
      expect(parsed.phaseIndex).toBe(DEMO_RUNNABLE_PHASES.indexOf("agenda") + 1);
      expect(demoProvisionStateSchema.safeParse({ ...parsed, phaseCount: 11 }).success).toBe(false);
    });
  });
});
