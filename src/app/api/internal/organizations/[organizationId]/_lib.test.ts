import { describe, expect, it } from "vitest";
import { requireOrganizationId } from "./_lib";

describe("requireOrganizationId", () => {
  const organizationId = "d3fa0000-0000-4000-8000-000000000001";

  it("parses a branded organization ID", () => {
    expect(requireOrganizationId({ organizationId })).toBe(organizationId);
  });

  it("rejects a missing or repeated route parameter with the existing validation error", () => {
    expect(() => requireOrganizationId({})).toThrow("organizationId route parameter is required");
    expect(() => requireOrganizationId({ organizationId: [organizationId] })).toThrow("organizationId route parameter is required");
  });

  it("rejects a malformed organization ID", () => {
    expect(() => requireOrganizationId({ organizationId: "not-a-uuid" })).toThrow("Invalid UUID");
  });
});
