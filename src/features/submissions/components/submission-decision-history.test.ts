import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("submission decision history", () => {
  it("keeps attribution organizer-only and renders the full reversible lifecycle", () => {
    const component = readFileSync(new URL("./submission-decision-history.tsx", import.meta.url), "utf8");
    const drawer = readFileSync(new URL("./submission-drawer.tsx", import.meta.url), "utf8");
    const route = readFileSync(
      new URL("../../../app/api/internal/submissions/[eventId]/[submissionId]/status-history/route.ts", import.meta.url),
      "utf8",
    );
    const transitionRoute = readFileSync(
      new URL("../../../app/api/internal/submissions/[eventId]/transition/route.ts", import.meta.url),
      "utf8",
    );
    const notifyRoute = readFileSync(
      new URL("../../../app/api/internal/submissions/[eventId]/notify/route.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain('adminAuth({ role: "organizer" })');
    expect(transitionRoute).toContain("userIdSchema.parse(session?.actorId)");
    expect(notifyRoute).toContain("userIdSchema.parse(session?.actorId)");
    expect(component).toContain("Queue moves, final decisions, reversals, and withdrawals remain visible here.");
    expect(component).toContain('role="alert"');
    expect(component).toContain("Finalized by");
    expect(component).not.toContain("notified");
    expect(component).toContain("Changed by speaker");
    expect(component).toContain("<TzTime instant={entry.changedAt} tz={timezone}");
    expect(drawer).toContain("<SubmissionDecisionHistory eventId={eventId} submissionId={submissionId} timezone={timezone} />");
    expect(drawer).toContain("{canEdit && (");
  });
});
