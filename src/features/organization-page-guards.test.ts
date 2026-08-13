import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `requireOrganizationAdmin(organizationId, role?)` takes the role as an
 * *optional* argument, and `authorizeOrganization` only compares roles when one
 * is supplied — so omitting it means "any `organization_members` row passes",
 * reviewers included. Every organizer-only page must therefore spell the role
 * out, or it silently sits below the `organizationAuth()` bar (organizer by
 * default) that its own API twin enforces: a reviewer who can read the CRM
 * directory can join speaker names back to submission titles and de-anonymize a
 * blind round, exactly the leak `scripts/check-invariants.sh` guards on the API
 * side and cannot see at the page level.
 */
const ORGANIZER_ONLY_PAGES = [
  "crm/page.tsx",
  "crm/pipeline/page.tsx",
  "crm/segments/page.tsx",
  "crm/[organizationContactId]/page.tsx",
  "audit/page.tsx",
  "team/page.tsx",
  "billing/page.tsx",
  "onboarding/page.tsx",
] as const;

function read(path: string): string {
  return readFileSync(new URL(`../app/organizations/[organizationId]/${path}`, import.meta.url), "utf8");
}

describe("organization page guards", () => {
  it.each(ORGANIZER_ONLY_PAGES)("%s requires organizer, not bare membership", (page) => {
    const source = read(page);
    expect(source).toContain('requireOrganizationAdmin(organizationId, "organizer")');
    expect(source).not.toMatch(/requireOrganizationAdmin\(organizationId\)/);
  });

  it("shows organizer-only links on the landing page only to organizers", () => {
    // The landing page itself stays on bare membership — a reviewer belongs in
    // their organization's event list — but must not offer links that 404.
    const source = read("page.tsx");
    expect(source).toContain("requireOrganizationAdmin(organizationId)");
    const start = source.indexOf("canManageEvents ? <>");
    expect(start).toBeGreaterThan(0);
    const gated = source.slice(start, source.indexOf("</>", start));
    for (const href of ["/crm`", "/billing`", "/audit`", "/team`", "/onboarding`"]) {
      expect(gated, `gated behind canManageEvents: ${href}`).toContain(href);
    }
  });
});
