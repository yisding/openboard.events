import { describe, expect, it } from "vitest";
import { organizationContactIdSchema, resolvedCrmSegmentSchema } from "@/shared/contracts";
import { beginLatestRequest, resolveCrmEmailAudience, updatePendingSegmentIds } from "./segments-view";

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

  it("tracks overlapping segment resolutions independently", () => {
    const first = "segment-a";
    const second = "segment-b";
    let pending = updatePendingSegmentIds(new Set(), first, true);
    pending = updatePendingSegmentIds(pending, second, true);
    pending = updatePendingSegmentIds(pending, second, false);
    expect([...pending]).toEqual([first]);
  });

  it("allows only the latest overlapping email resolution to open a dialog", async () => {
    const sequence = { current: 0 };
    const opened: string[] = [];
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstResolution = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondResolution = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const run = async (name: string, resolution: Promise<void>) => {
      const isLatest = beginLatestRequest(sequence);
      await resolution;
      if (isLatest()) opened.push(name);
    };

    const first = run("first", firstResolution);
    const second = run("second", secondResolution);
    releaseSecond();
    await second;
    releaseFirst();
    await first;

    expect(opened).toEqual(["second"]);
  });
});
