import { describe, expect, it, vi } from "vitest";
import { contactIdSchema, eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";
import { adminAuth, apiKeyAuth, organizationAuth, portalAuth, publicAuth } from "./guards";
import { requireAdmin, requireOrganizationAdmin } from "./admin";
import { requirePortalByEventId } from "./portal";

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

vi.mock("./portal", () => ({ requirePortalByEventId: vi.fn() }));

/**
 * `defineHandler`'s origin check (PLAN P3-SEC) trusts `csrfExempt` on the
 * guard function itself. Pinned here so a refactor of any guard cannot
 * silently drop (or add) the flag without a failing test — the API-key bearer
 * token stays exempt and every cookie-session guard stays checked.
 */
describe("guard csrfExempt flags", () => {
  it("marks the non-browser-credential guards exempt", () => {
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
 * An organizer inside "Open portal as …" acts as the speaker but is not the
 * speaker. The guard is the only place both identities exist, so a mutation
 * route can attribute the action to the admin only if the guard hands it over —
 * dropping it here is what left `task_completions.completed_by_user_id` null
 * for every impersonated action, with no audit trail anywhere.
 */
describe("portalAuth impersonation identity", () => {
  const eventId = eventIdSchema.parse("5f000000-0000-4000-8000-0000000000e2");
  const contactId = contactIdSchema.parse("5f000000-0000-4000-8000-0000000000c1");
  const organizerId = userIdSchema.parse("5f000000-0000-4000-8000-0000000000d1");
  const request = {} as Parameters<ReturnType<typeof portalAuth>>[0];
  const portalSession = (impersonatedByUserId: typeof organizerId | null) => ({
    contactId, eventId, email: "ada@example.com", impersonatedByUserId,
  });

  it("carries the organizer behind an impersonated session", async () => {
    vi.mocked(requirePortalByEventId).mockResolvedValue(portalSession(organizerId));
    await expect(portalAuth()(request, eventId, {})).resolves.toEqual({
      actorId: contactId, role: "portal", impersonatedByUserId: organizerId,
    });
  });

  it("reports no admin behind a speaker signed in as themselves", async () => {
    vi.mocked(requirePortalByEventId).mockResolvedValue(portalSession(null));
    await expect(portalAuth()(request, eventId, {})).resolves.toEqual({
      actorId: contactId, role: "portal", impersonatedByUserId: null,
    });
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
