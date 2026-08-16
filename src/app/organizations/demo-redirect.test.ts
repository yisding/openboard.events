import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { organizationHomeDestination, type OrganizationHomeState } from "@/features/organizations/event-creation";

/**
 * First Fair (design §1.4) — the redirect matrix, and the three traps it
 * exists to retire.
 *
 * The organization home is the only screen in the product that can strand a
 * new organizer, and it can do it in two opposite directions at once: send
 * them into a setup wizard they can never leave, or quietly stop asking them
 * to set anything up at all. Introducing a demo event is exactly the change
 * that makes both possible, because a demo is a row in `events` that is not a
 * programme. This table is the whole contract.
 */

const BASE: OrganizationHomeState = {
  canManageEvents: true,
  realEventCount: 0,
  hasDemoEvent: false,
  hasOpenCheckpoint: false,
  skipRequested: false,
};

const MATRIX: ReadonlyArray<{
  name: string;
  state: Partial<OrganizationHomeState>;
  destination: "onboarding" | "home";
  why: string;
}> = [
  {
    name: "no events, no checkpoint",
    state: {},
    destination: "onboarding",
    why: "today's behaviour, unchanged: a brand-new organization's first screen is the setup front door",
  },
  {
    name: "demo only, no checkpoint",
    state: { hasDemoEvent: true },
    destination: "home",
    why: "Trap B: the demo exists, so the organizer has already met the fork and is left alone with a create CTA",
  },
  {
    name: "demo plus an open checkpoint",
    state: { hasDemoEvent: true, hasOpenCheckpoint: true },
    destination: "onboarding",
    why: "Trap C: a half-built real event outranks a tutorial",
  },
  {
    name: "real events only",
    state: { realEventCount: 3 },
    destination: "home",
    why: "unchanged: an established organization is never interrupted",
  },
  {
    name: "real events plus an open checkpoint",
    state: { realEventCount: 3, hasOpenCheckpoint: true },
    destination: "onboarding",
    why: "unchanged: unfinished setup is still unfinished",
  },
  {
    name: "no events, but the fork's escape hatch was used",
    state: { skipRequested: true },
    destination: "home",
    why: "?skip=1 buys exactly one request without the redirect, so 'take me to my organization' is not a loop",
  },
  {
    name: "no events, escape hatch used, but a checkpoint is open",
    state: { skipRequested: true, hasOpenCheckpoint: true },
    destination: "onboarding",
    why: "?skip=1 declines the fork, not an unfinished real event",
  },
  {
    name: "a reviewer with nothing",
    state: { canManageEvents: false },
    destination: "home",
    why: "a reviewer cannot create events and belongs in the directory, redirected nowhere",
  },
];

describe("organization home redirect matrix", () => {
  it.each(MATRIX)("$name -> $destination ($why)", ({ state, destination }) => {
    expect(organizationHomeDestination({ ...BASE, ...state })).toBe(destination);
  });

  it("counts real events, never the demo, when deciding to nudge", () => {
    // The single line the whole of Trap B hangs on. If this ever becomes
    // `eventRows.length === 0`, an organization whose only event is a
    // tutorial silently stops being asked to run a conference.
    expect(organizationHomeDestination({ ...BASE, realEventCount: 0, hasDemoEvent: true })).toBe("home");
    expect(organizationHomeDestination({ ...BASE, realEventCount: 1, hasDemoEvent: true })).toBe("home");
    expect(organizationHomeDestination({ ...BASE, realEventCount: 0, hasDemoEvent: false })).toBe("onboarding");
  });

  it("is the rule the organization home actually applies", () => {
    // Pinned as source, because the trap is not in the predicate — it is in
    // somebody later adding a second, looser redirect above it.
    const page = readFileSync(new URL("./[organizationId]/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("organizationHomeDestination({");
    expect(page).toContain("const realEventCount = eventRows.filter((row) => !row.isDemo).length;");
    expect(page).not.toContain("eventRows.length === 0");
    expect(page.match(/redirect\(`\/organizations\/\$\{organizationId\}\/onboarding`\)/gu)).toHaveLength(1);
  });

  it("keeps Trap A structural: the demo path writes no setup checkpoint", () => {
    // `hasOpenCheckpoint` can only ever describe a real event, because nothing
    // under `server/demo/` starts an organization onboarding row. Asserted at
    // the source so a future phase runner cannot quietly reach for the
    // wizard's checkpoint to track its own progress.
    const provisioning = readFileSync(
      new URL("../../features/onboarding/server/demo/provisioning.ts", import.meta.url),
      "utf8",
    );
    expect(provisioning).not.toContain("startOrganizationOnboarding");
    expect(provisioning).not.toContain("provisionOrganizationEvent");
  });
});
