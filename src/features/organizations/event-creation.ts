import type { OrganizationMembership } from "./server/queries";

export function manageableOrganizations(memberships: readonly OrganizationMembership[]): OrganizationMembership[] {
  return memberships.filter(({ role }) => role === "owner" || role === "organizer");
}

/**
 * Route event creation directly when unambiguous, otherwise to a filtered chooser.
 *
 * First Fair (design §1.2): `?mode=create` is the "I already know what I want"
 * flag. The onboarding route is also the demo event's front door, and an
 * organizer who just pressed a button labelled *Create event* must never be
 * asked whether they would rather take a tutorial instead. Explicit intent
 * always wins, so every entrance that carries one says so in the URL — and the
 * entrances that do not (a bare `/organizations/{id}/onboarding` from
 * documentation, or the post-signup landing) are exactly the ones where
 * offering the choice is the right thing to do.
 */
export function eventCreationDestination(memberships: readonly OrganizationMembership[]): string {
  const manageable = manageableOrganizations(memberships);
  const [only] = manageable;
  return manageable.length === 1 && only
    ? `/organizations/${only.organization.id}/onboarding?mode=create`
    : "/organizations?intent=create-event";
}

/** What the organization home has to know about its own event list. */
export type OrganizationHomeState = {
  /** Owner or organizer. A reviewer is never redirected anywhere. */
  canManageEvents: boolean;
  /** Events that are not the demo. The tutorial must not count as a programme. */
  realEventCount: number;
  hasDemoEvent: boolean;
  /** An unfinished setup checkpoint for this organizer. */
  hasOpenCheckpoint: boolean;
  /** `?skip=1` — the fork's "take me to my organization" escape hatch. */
  skipRequested: boolean;
};

/**
 * First Fair (design §1.4) — the redirect matrix, as one pure function.
 *
 * Three traps live in these four lines, and all three are the same mistake in
 * different directions: letting a *tutorial* stand in for a customer's real
 * programme.
 *
 *   - **Trap A** — stuck in the setup wizard forever, because provisioning
 *     left an `event_onboarding_progress` row behind. Retired structurally:
 *     the demo path never writes one, so `hasOpenCheckpoint` can only ever
 *     describe a real event the organizer half-built.
 *   - **Trap B** — never nudged to make a real event, because the moment any
 *     row exists `eventRows.length === 0` goes false and the eventless
 *     redirect dies for good. Counting *real* events is the fix: an
 *     organization holding nothing but a demo still gets sent to setup's front
 *     door, and once it has been there (`?skip=1`, or a demo now exists) it is
 *     left alone.
 *   - **Trap C** — a half-built real event outranks a tutorial, always. The
 *     checkpoint is checked first and on its own.
 *
 * Returning a *destination* rather than performing the redirect is what makes
 * the whole matrix a table test instead of a route test.
 */
export function organizationHomeDestination(state: OrganizationHomeState): "onboarding" | "home" {
  if (!state.canManageEvents) return "home";
  if (state.hasOpenCheckpoint) return "onboarding";
  if (state.realEventCount === 0 && !state.hasDemoEvent && !state.skipRequested) return "onboarding";
  return "home";
}
