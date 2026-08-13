import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("user-facing copy regressions", () => {
  it("does not expose internal data identifiers or raw session state", () => {
    const dashboard = read("./dashboard/components/SpeakerTrackingPanel.tsx");
    const contactHistory = read("./crm/components/contact-detail-view.tsx");

    expect(dashboard).not.toContain("From accepted_speakers_v");
    expect(contactHistory).not.toContain("<span>{session.status}</span>");
    expect(contactHistory).toContain('<StatusBadge value={session.status} />');
  });

  it("uses actionable fallbacks instead of a generic failure", () => {
    const cfp = read("./forms/components/cfp-steps.tsx");
    const deliverables = read("./portal/deliverables/components/files-admin-view.tsx");

    expect(`${cfp}${deliverables}`).not.toContain("Something went wrong");
    expect(cfp).toContain("We couldn’t complete that request. Try again.");
    expect(deliverables).toContain("The export could not be prepared. Use the export menu to try again.");
  });
});
