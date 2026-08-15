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
    const fileUpload = read("../shared/ui/app/file-upload.tsx");

    expect(`${cfp}${deliverables}${fileUpload}`).not.toContain("Something went wrong");
    expect(cfp).toContain("We couldn’t complete that request. Try again.");
    expect(deliverables).toContain("The export could not be prepared. Use the export menu to try again.");
    expect(fileUpload).toContain("The upload could not be completed. Try again.");
  });

  it("keeps the guided tour's failure copy specific", () => {
    // The tour is thirty-odd cards of authored English shipped as data, which
    // makes it the largest single body of copy in the product and the easiest
    // place for a generic apology to slip in. Failure copy has to say what did
    // not happen and what the organizer can do instead — and nothing in a
    // tutorial may imply the demo can reach a real inbox.
    const script = read("./onboarding/tour/script.ts");

    expect(script).not.toContain("Something went wrong");
    expect(script).not.toContain("Oops");
    expect(script).toContain("mail is never delivered");
    expect(script).toContain("None of it is real");
    // The one quest that asks the organizer to receive something has to name
    // the real barrier. "the demo's speakers cannot receive a code" blamed the
    // recipients; the guard keys off the *event*, so the organizer's own real
    // address gets nothing either.
    expect(script).not.toContain("the demo's speakers cannot receive a code");
    expect(script).toContain("the demo event suppresses every message");
  });

  it("labels non-production credentials as demo access instead of development diagnostics", () => {
    const cfp = read("./forms/components/cfp-steps.tsx");
    const portal = read("./auth/components/portal-login-form.tsx");
    const signup = read("../app/signup/check-email/page.tsx");
    const surfaces = `${cfp}${portal}${signup}`;

    expect(surfaces).not.toContain("Development code");
    expect(surfaces).not.toContain("Development / fallback mode");
    expect(surfaces).toContain("Demo access code");
    expect(surfaces).toContain("Your one-time code");
    expect(surfaces).toContain("Confirm email and continue");
  });
});
