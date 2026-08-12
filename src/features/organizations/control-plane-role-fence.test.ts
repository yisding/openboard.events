import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = (relativePath: string) => readFileSync(
  new URL(`../../app/organizations/[organizationId]/${relativePath}`, import.meta.url),
  "utf8",
);

describe("organization control-plane role fence", () => {
  it.each([
    "crm/page.tsx",
    "crm/[organizationContactId]/page.tsx",
    "crm/pipeline/page.tsx",
    "crm/segments/page.tsx",
    "team/page.tsx",
    "audit/page.tsx",
    "billing/page.tsx",
  ])("requires organizer access before reading %s", (relativePath) => {
    const source = pageSource(relativePath);
    const guard = source.indexOf('requireOrganizationAdmin(organizationId, "organizer")');
    const firstProtectedRead = source.indexOf("await Promise.all", guard);

    expect(guard).toBeGreaterThan(0);
    expect(firstProtectedRead).toBeGreaterThan(guard);
    expect(source).not.toContain("requireOrganizationAdmin(organizationId);");
  });

  it("does not advertise organizer control-plane links to reviewers", () => {
    const source = pageSource("page.tsx");
    const actions = source.slice(source.indexOf("actions="), source.indexOf("</PageHeader>"));

    expect(source).toContain('canManageEvents = roleSatisfies(session.role, "organizer")');
    expect(actions).toContain("actions={canManageEvents ? <>");
    expect(actions).toContain("/crm");
    expect(actions).toContain("/billing");
    expect(actions).toContain("/audit");
    expect(actions).toContain("/team");
    expect(actions).toContain(": undefined}");
  });
});
