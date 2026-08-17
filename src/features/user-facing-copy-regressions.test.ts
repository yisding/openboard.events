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
    // The export-failure fallback now lives in the files-selection helper the
    // view renders from, not inline in the view.
    const deliverablesSelection = read("./portal/deliverables/components/files-selection.ts");
    const fileUpload = read("../shared/ui/app/file-upload.tsx");

    expect(`${cfp}${deliverables}${deliverablesSelection}${fileUpload}`).not.toContain("Something went wrong");
    expect(cfp).toContain("We couldn’t complete that request. Try again.");
    expect(deliverablesSelection).toContain("The export could not be prepared. Use the export menu to try again.");
    expect(fileUpload).toContain("The upload could not be completed. Try again.");
  });

  it("keeps the Airtable panel free of raw run statuses, scope strings, and generic failures", () => {
    const copy = read("./airtable/copy.ts");
    const card = read("./airtable/components/SyncStatusCard.tsx");
    const panel = read("./airtable/components/AirtableSettingsPanel.tsx");

    // Four backend run statuses, four authored labels — the badge, never the
    // enum. Matched loosely on whitespace so a formatter that wraps the
    // attribute does not read as a copy regression.
    expect(card).toMatch(/<StatusBadge\s+value=\{RUN_BADGES\[row\.original\.status\]\}\s*\/>/u);
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
    // The delivery log is where the tour stakes its credibility, and it is
    // also the one screen that can contradict it at a glance. This guard used
    // to ban "Every row reads skipped" outright, because phase 10 then
    // backdated six `sent` rows and one `failed` — the sweeping claim was
    // falsifiable by reading the column the card was pointing at. Phase 10
    // now seeds all nine as `skipped` (`phases-06-10.test.ts` enforces it),
    // so the sweeping claim is true again and deliberately restored. What is
    // *still* falsifiable on that screen is a render: the dispatcher stops a
    // demo send before it renders (#679), which is why a live row carries the
    // skip reason where its subject would be — so the tour may not promise a
    // render the product deliberately never performs.
    //
    // The count is gone too (#709): nine is the *seed's* backdated row count,
    // but the log this card points at also holds the live reminder sweeper's
    // output — roughly fifty more rows — so a player who counts what is on
    // screen gets a number well past nine. The copy now says "the oldest
    // rows" instead of a number that only the dataset, never the screen,
    // agrees with.
    expect(script).toContain("Every row reads skipped");
    expect(script).not.toContain("rendered in full");
    expect(script).not.toContain("rendered and logged");
    expect(script).not.toContain("rendered, logged");
    expect(script).not.toContain("Nine seeded messages");
  });

  // These credentials belong to a real deployment whose mail is restricted, not
  // to a sandbox. "Demo access" read as "the whole instance is a demo" to people
  // testing signup on preview, which is exactly the wrong thing to tell them;
  // "Development code" reads as a leaked diagnostic. Name the environment.
  it("labels non-production credentials by environment, not as a demo or a dev diagnostic", () => {
    const cfp = read("./forms/components/cfp-steps.tsx");
    const portal = read("./auth/components/portal-login-form.tsx");
    const signup = read("../app/signup/check-email/page.tsx");
    const surfaces = `${cfp}${portal}${signup}`;

    expect(surfaces).not.toContain("Development code");
    expect(surfaces).not.toContain("Development / fallback mode");
    expect(surfaces).not.toContain("Demo access");
    expect(surfaces).toContain("Test environment code");
    expect(surfaces).toContain("Your one-time code");
    expect(surfaces).toContain("Confirm email and continue");
  });
});
