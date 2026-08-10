import { describe, expect, it, vi } from "vitest";
import { eventIdSchema, organizationIdSchema } from "@/shared/contracts";
import { adminAuth, apiKeyAuth, cronAuth, organizationAuth, portalAuth, publicAuth } from "./guards";
import { requireAdmin, requireOrganizationAdmin } from "./admin";

vi.mock("./admin", () => ({
  requireAdmin: vi.fn(async (eventId: string) => ({
    userId: "5f000000-0000-4000-8000-000000000001",
    email: "member@example.com",
    name: "Member",
    role: "reviewer",
    eventId,
  })),
  requireOrganizationAdmin: vi.fn(async (organizationId: string) => ({
    userId: "5f000000-0000-4000-8000-000000000001",
    email: "member@example.com",
    name: "Member",
    role: "organizer",
    organizationId,
  })),
}));

/**
 * `defineHandler`'s origin check (PLAN P3-SEC) trusts `csrfExempt` on the
 * guard function itself. Pinned here so a refactor of any guard cannot
 * silently drop (or add) the flag without a failing test — the two
 * non-cookie guards (cron shared-secret, api-key bearer token) stay exempt,
 * every cookie-session guard stays checked.
 */
describe("guard csrfExempt flags", () => {
  it("marks the non-browser-credential guards exempt", () => {
    expect(cronAuth().csrfExempt).toBe(true);
    expect(apiKeyAuth().csrfExempt).toBe(true);
  });

  it("leaves the cookie-session guards unmarked (checked by default)", () => {
    expect(adminAuth().csrfExempt).toBeUndefined();
    expect(organizationAuth().csrfExempt).toBeUndefined();
    expect(portalAuth().csrfExempt).toBeUndefined();
    expect(publicAuth().csrfExempt).toBeUndefined();
  });
});

/**
 * M43 — the organization-scoped guard is `adminAuth`'s shape one level up: the
 * same fail-closed organizer default, applied to `organization_members`. It
 * reads its id from the route's `organizationId` segment, never from the
 * `eventId` one, so an event-scoped route can never accidentally authorize
 * against an organization (or the reverse).
 */
describe("organizationAuth", () => {
  const organizationId = organizationIdSchema.parse("5f000000-0000-4000-8000-0000000000a1");
  const request = {} as Parameters<ReturnType<typeof organizationAuth>>[0];

  it("demands organizer when a route names no role", async () => {
    vi.mocked(requireOrganizationAdmin).mockClear();
    await organizationAuth()(request, null, { organizationId });
    expect(vi.mocked(requireOrganizationAdmin)).toHaveBeenCalledWith(organizationId, "organizer");
  });

  it("lowers the bar only where a route asks for it", async () => {
    vi.mocked(requireOrganizationAdmin).mockClear();
    await organizationAuth({ role: "reviewer" })(request, null, { organizationId });
    expect(vi.mocked(requireOrganizationAdmin)).toHaveBeenCalledWith(organizationId, "reviewer");
  });

  it("rejects a route with a missing or malformed organizationId", async () => {
    await expect(organizationAuth()(request, null, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(organizationAuth()(request, null, { organizationId: "not-a-uuid" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

/**
 * M50 — blindness is only as good as the surfaces around it. A guard with no
 * stated role used to admit any event member, so a reviewer on an anonymized
 * round could read the organizer-only speaker roster and join names back to the
 * codes and titles in their blind queue. The default is organizer, exactly as
 * `agendaAuth` and `tasksAdminAuth` already default, and the reviewer-facing
 * routes say `{ role: "reviewer" }` out loud.
 */
describe("adminAuth required role", () => {
  const eventId = eventIdSchema.parse("5f000000-0000-4000-8000-0000000000e1");
  const request = {} as Parameters<ReturnType<typeof adminAuth>>[0];

  it("demands organizer when a route names no role", async () => {
    vi.mocked(requireAdmin).mockClear();
    await adminAuth()(request, eventId, {});
    expect(vi.mocked(requireAdmin)).toHaveBeenCalledWith(eventId, "organizer");
  });

  it("lowers the bar only where a route asks for it", async () => {
    vi.mocked(requireAdmin).mockClear();
    await adminAuth({ role: "reviewer" })(request, eventId, {});
    expect(vi.mocked(requireAdmin)).toHaveBeenCalledWith(eventId, "reviewer");
  });
});
