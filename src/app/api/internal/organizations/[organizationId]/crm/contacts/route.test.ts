import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationIdSchema } from "@/shared/contracts";

const mocks = vi.hoisted(() => ({
  listOrganizationContacts: vi.fn(),
}));

// Auth passes so we exercise the query-schema transform, not the guard.
vi.mock("@/features/auth", () => ({
  organizationAuth: () => async () => ({ actorId: "organizer", role: "organizer", eventId: null }),
}));

vi.mock("@/features/crm", () => ({
  listOrganizationContacts: mocks.listOrganizationContacts,
  createOrganizationContact: vi.fn(),
}));

const { GET } = await import("./route");

const organizationId = organizationIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const route = { params: Promise.resolve({ organizationId }) };
const url = (query: string) =>
  new NextRequest(`https://example.test/api/internal/organizations/${organizationId}/crm/contacts${query}`);

describe("GET crm/contacts customFields query param", () => {
  beforeEach(() => {
    mocks.listOrganizationContacts.mockReset().mockResolvedValue({ contacts: [], total: 0 });
  });

  it("maps malformed customFields JSON to a 400 VALIDATION error, not a 500", async () => {
    const response = await GET(url("?customFields=notjson"), route);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION", message: "customFields must be valid JSON" },
    });
    expect(mocks.listOrganizationContacts).not.toHaveBeenCalled();
  });

  it("parses a valid customFields JSON blob through to the listing filter", async () => {
    const response = await GET(url(`?customFields=${encodeURIComponent(JSON.stringify({ diet: "vegan" }))}`), route);

    expect(response.status).toBe(200);
    expect(mocks.listOrganizationContacts).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ customFields: { diet: "vegan" } }),
    );
  });
});
