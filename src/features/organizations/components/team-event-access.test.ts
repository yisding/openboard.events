import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventAccessRoleInputSchema } from "../schemas";

describe("organization Team event access", () => {
  const panel = readFileSync(new URL("./team-panel.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server/event-access.ts", import.meta.url), "utf8");

  it("never offers event ownership as a Team grant", () => {
    expect(eventAccessRoleInputSchema.safeParse({ role: "reviewer" }).success).toBe(true);
    expect(eventAccessRoleInputSchema.safeParse({ role: "organizer" }).success).toBe(true);
    expect(eventAccessRoleInputSchema.safeParse({ role: "owner" }).success).toBe(false);
    expect(panel).toContain('<option value="reviewer" disabled={row.role === "organizer"}>');
    expect(panel).toContain("Ownership is managed inside the event.");
  });

  it("shows only server-authorized events and confirms explicit removal", () => {
    expect(panel).toContain("You can manage only events where you are already an organizer.");
    expect(panel).toContain("No manageable events");
    expect(panel).toContain("<KeyRound size={14} /> Event access");
    expect(panel).toContain("setPendingAccessRemoval(row)");
    expect(panel).toContain('confirmLabel="Remove event access"');
    expect(panel).toContain("Their organization membership is unchanged.");
    expect(panel).toContain("if (eventAccessRequest.current !== request) return;");
    expect(panel).toContain("if (!accessMember || eventAccessBusy || !beginTeamWrite()) return;");
  });

  it("rechecks every authorization axis in the write itself", () => {
    expect(server).toContain("event.organization_id = ${organizationId}::uuid");
    expect(server).toContain("actor_org.role IN ('owner', 'organizer')");
    expect(server).toContain("target_org.user_id = ${targetUserId}::uuid");
    expect(server).toContain("actor_event.role IN ('owner', 'organizer')");
    expect(server).toContain("WHEN event_members.role IN ('owner', 'organizer') THEN event_members.role");
    expect(server).toContain('if (actorUserId === targetUserId) throw new AppError("VALIDATION"');
    expect(server).toContain('if (row.existing_role === "owner")');
  });
});
