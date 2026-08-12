import type { OrganizationMembership } from "./server/queries";

export function manageableOrganizations(memberships: readonly OrganizationMembership[]): OrganizationMembership[] {
  return memberships.filter(({ role }) => role === "owner" || role === "organizer");
}

/** Route event creation directly when unambiguous, otherwise to a filtered chooser. */
export function eventCreationDestination(memberships: readonly OrganizationMembership[]): string {
  const manageable = manageableOrganizations(memberships);
  const [only] = manageable;
  return manageable.length === 1 && only
    ? `/organizations/${only.organization.id}/onboarding`
    : "/organizations?intent=create-event";
}
