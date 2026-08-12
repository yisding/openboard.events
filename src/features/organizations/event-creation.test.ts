import { describe, expect, it } from "vitest";
import { organizationDtoSchema, type MemberRole } from "@/shared/contracts";
import type { OrganizationMembership } from "./server/queries";
import { eventCreationDestination, manageableOrganizations } from "./event-creation";

function membership(index: number, role: MemberRole): OrganizationMembership {
  return {
    organization: organizationDtoSchema.parse({
      id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Organization ${index}`,
      slug: `organization-${index}`,
      createdAt: "2026-08-12T00:00:00.000Z",
    }),
    role,
  };
}

describe("eventCreationDestination", () => {
  it("goes straight to guided onboarding for one manageable organization", () => {
    const organizer = membership(1, "organizer");
    expect(eventCreationDestination([organizer, membership(2, "reviewer")]))
      .toBe(`/organizations/${organizer.organization.id}/onboarding`);
  });

  it("uses the creation chooser for multiple or no manageable organizations", () => {
    expect(eventCreationDestination([membership(1, "owner"), membership(2, "organizer")]))
      .toBe("/organizations?intent=create-event");
    expect(eventCreationDestination([membership(3, "reviewer")]))
      .toBe("/organizations?intent=create-event");
  });

  it("never treats reviewer membership as event-creation authority", () => {
    expect(manageableOrganizations([membership(1, "reviewer")])).toEqual([]);
  });
});
