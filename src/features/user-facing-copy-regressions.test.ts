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

  it("keeps the Airtable panel free of raw run statuses, scope strings, and generic failures", () => {
    const copy = read("./airtable/copy.ts");
    const card = read("./airtable/components/SyncStatusCard.tsx");
    const panel = read("./airtable/components/AirtableSettingsPanel.tsx");

    // Four backend run statuses, four authored labels — the badge, never the enum.
    expect(card).toContain("<StatusBadge value={RUN_BADGES[row.original.status]} />");
    expect(card).not.toContain("{row.original.status}");
    expect(card).toContain("{AIRTABLE_COPY.trigger[row.original.trigger]}");

    // Airtable's own scope identifiers are configuration, not language. They
    // appear in `scopes.ts` as data and nowhere as rendered text.
    expect(copy).not.toContain("data.records:");
    expect(copy).not.toContain("schema.bases:");

    const surfaces = `${copy}${card}${panel}`;
    expect(surfaces).not.toMatch(/something went wrong/iu);
    expect(surfaces).not.toMatch(/an error occurred/iu);
    expect(surfaces).not.toMatch(/unexpected error/iu);

    // Bounded work names its remainder rather than reading as truncation.
    expect(copy).toContain("the next run picks up exactly where this one stopped");
    // And a disconnect says what happens to the customer's own data.
    expect(copy).toContain("stay exactly as they are — that base is yours");
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
