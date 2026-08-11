import { describe, expect, it } from "vitest";
import { organizationContactIdSchema, resolvedCrmSegmentSchema } from "@/shared/contracts";
import { resolveCrmEmailAudience } from "./segments-view";

const contactId = organizationContactIdSchema.parse("94000000-0000-4000-8000-000000000001");

describe("resolveCrmEmailAudience", () => {
  it("returns only a freshly loaded nonempty audience", async () => {
    const result = resolvedCrmSegmentSchema.parse({
      matchedCount: 1,
      organizationContactIds: [contactId],
      capped: false,
      preview: [{ organizationContactId: contactId, email: "speaker@example.com", name: "Speaker" }],
    });
    await expect(resolveCrmEmailAudience(async () => result)).resolves.toEqual({ result, error: null });
  });

  it("refuses empty audiences and reports rejected refreshes", async () => {
    const empty = resolvedCrmSegmentSchema.parse({ matchedCount: 0, organizationContactIds: [], capped: false, preview: [] });
    await expect(resolveCrmEmailAudience(async () => empty)).resolves.toEqual({ result: empty, error: "No contacts currently match this segment" });
    await expect(resolveCrmEmailAudience(async () => { throw new Error("offline"); })).resolves.toEqual({ result: null, error: "Could not resolve this segment — try again" });
  });
});
