import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventAccessMemberDtoSchema } from "@/shared/contracts";

describe("event-scoped access recovery", () => {
  const server = readFileSync(new URL("../server/event-access.ts", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../../events/components/settings-shell.tsx", import.meta.url), "utf8");
  const accessTab = readFileSync(new URL("../../events/components/event-access-tab.tsx", import.meta.url), "utf8");

  it("models former organization members as removable event members", () => {
    expect(eventAccessMemberDtoSchema.parse({
      userId: "c4300000-0000-4000-8000-000000000013",
      email: "former@example.com",
      name: "Former teammate",
      role: "organizer",
      organizationMember: false,
      canRemove: true,
    })).toMatchObject({ organizationMember: false, canRemove: true });
  });

  it("lists every event membership and revokes without requiring target organization membership", () => {
    const eventRemoval = server.slice(server.indexOf("export async function removeEventAccessMemberIn"));
    expect(server).toContain("organizationMemberUserId !== null");
    expect(eventRemoval).toContain("membership.role IN ('owner', 'organizer')");
    expect(eventRemoval).not.toContain("targetOrganizationMemberships");
    expect(eventRemoval).not.toContain("target_org");
    expect(eventRemoval).toContain('row.existing_role === "owner"');
    expect(eventRemoval).toContain("actorUserId === targetUserId");
  });

  it("exposes the canonical roster in Event Settings with confirmation", () => {
    expect(settings).toContain('["access", "Access", KeyRound]');
    expect(settings).toContain('tab === "access" && <EventAccessTab');
    expect(accessTab).toContain("including former organization teammates");
    expect(accessTab).toContain("No longer in this organization");
    expect(accessTab).toContain('confirmLabel="Remove event access"');
    expect(accessTab).toContain("current.filter((member) => member.userId !== removed.userId)");
  });
});
