import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry) && !/\.(?:test|spec)\.tsx?$/u.test(entry) ? [path] : [];
  });
}

/** One run of authored text: a string literal, a template chunk, or JSX body text. */
type CopySpan = { file: string; text: string; jsx: boolean };

/**
 * Everything in `src/` that can reach a reader as words, and nothing that
 * cannot. Identifiers, JSX attribute *names*, imports and `//`-comments are not
 * spans; SQL `--` comment lines inside a template literal are dropped because a
 * tagged `sql` template is code that happens to be a string.
 */
function copySpans(): CopySpan[] {
  const spans: CopySpan[] = [];
  for (const path of sourceFiles(SRC)) {
    const text = readFileSync(path, "utf8");
    const file = relative(SRC, path);
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      const jsx = ts.isJsxText(node);
      const isCopy = jsx
        || ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node);
      if (isCopy) {
        const raw = text.slice(node.getStart(source), node.getEnd());
        for (const line of raw.split("\n")) {
          if (/^\s*--/u.test(line)) continue;
          spans.push({ file, text: line, jsx });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return spans;
}

const SPANS = copySpans();

const offenders = (pattern: RegExp, only?: (span: CopySpan) => boolean) => SPANS
  .filter((span) => (only ? only(span) : true) && pattern.test(span.text))
  .map((span) => `${span.file}: ${span.text.trim()}`);

/** Attribute values the product renders as a control's own name. */
const labelValues = (attribute: "label" | "title") => sourceFiles(SRC).flatMap((path) => {
  const file = relative(SRC, path);
  return [...readFileSync(path, "utf8").matchAll(new RegExp(`\\b${attribute}="([^"{}]+)"`, "gu"))]
    .map((match) => ({ file, value: match[1] ?? "" }));
});

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

  // A refusal that opens with the success screen's own heading is read as a
  // confirmation, and this one is shown to someone deciding whether to keep
  // waiting for an email that was never sent.
  it("does not word the portal sign-in throttle as a delivery confirmation", () => {
    const throttle = read("./auth/server/portal.ts");
    const [, message] = /PORTAL_LOGIN_THROTTLE_MESSAGE = "([^"]+)"/u.exec(throttle) ?? [];

    expect(message).toBeDefined();
    expect(message).not.toMatch(/^Check your inbox/u);
    expect(message).toMatch(/already have a code/u);
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

/**
 * #637 — four conventions that were each individually trivial and collectively
 * made the product read as if several people had written it. They are policed
 * here rather than in a style guide nobody opens, because every one of them
 * drifted back in through code review that was looking at behaviour.
 */
describe("copy conventions", () => {
  // Curly apostrophes were already the majority and the typographically right
  // answer; the split was ~50 files deep, with the same sentence shipped both
  // ways. `&apos;`/`&rsquo;` are the entity spelling of the same characters —
  // JSX needs the escape only for a *straight* quote, so a typographic one is
  // written as itself and reads as itself in the source too.
  it("writes every apostrophe and quote in rendered copy as its typographic character", () => {
    expect(offenders(/[A-Za-z]'(?:t|s|re|ve|ll|d|m)\b/u)).toEqual([]);
    expect(offenders(/&(?:apos|rsquo|ldquo|rdquo);/u, (span) => span.jsx)).toEqual([]);
  });

  // Toasts clustered by author: "Saved", "Changes saved" and "Saved
  // successfully." were three spellings of one act, and a minority carried a
  // trailing period the rest did not. A confirmation names what it confirmed,
  // and a single sentence takes no terminal period — multi-sentence recovery
  // copy still punctuates normally.
  it("confirms a save by naming what was saved, and leaves single-sentence toasts unpunctuated", () => {
    const messages = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      return [...readFileSync(path, "utf8").matchAll(/\btoast\(\s*"([^"]+)"/gu)].map((match) => ({ file, message: match[1] ?? "" }));
    });
    expect(messages.length).toBeGreaterThan(100);

    const anonymous = messages.filter(({ message }) => /^(?:Saved|Success|Changes saved|Saved successfully)\.?$/u.test(message));
    expect(anonymous.map(({ file, message }) => `${file}: ${message}`)).toEqual([]);

    const oneSentence = messages.filter(({ message }) => message.endsWith(".") && !message.slice(0, -1).includes(". "));
    expect(oneSentence.map(({ file, message }) => `${file}: ${message}`)).toEqual([]);
  });

  // One start/end pair had four label sets across the product — "Starts At",
  // "Starts at", "Starts", "Opens at". The bare verb wins (it was already the
  // majority, and "at" adds nothing beside a datetime control), and a label is
  // a name rather than a lead-in, so none of them ends in a colon.
  it("names a start, an end and a deadline the same way everywhere", () => {
    const labels = labelValues("label");
    expect(labels.length).toBeGreaterThan(50);

    const dangling = labels.filter(({ value }) => /^(?:Starts|Ends|Opens|Closes)\s+at$/iu.test(value));
    expect(dangling.map(({ file, value }) => `${file}: ${value}`)).toEqual([]);

    const punctuated = labels.filter(({ value }) => value.endsWith(":"));
    expect(punctuated.map(({ file, value }) => `${file}: ${value}`)).toEqual([]);
  });

  // American spelling in copy (the comments keep their own voice), one casing
  // for the itinerary surface, and a brand that is capitalised in prose. The
  // lowercase wordmark is a logo, so it stays lowercase — and only there.
  it("keeps one spelling of the program, the itinerary and the brand", () => {
    expect(offenders(/programme/iu)).toEqual([]);
    expect(offenders(/My Schedule/u)).toEqual([]);

    const wordmark = new Set(["shared/ui/brand.tsx", "app/global-error.tsx"]);
    expect(offenders(/\bopenboard\b/u, (span) => span.jsx && !wordmark.has(span.file))).toEqual([]);
  });

  // Sentence case is the product's register; "Submission Forms" and "Portal
  // Forms" were the two page titles that had slipped into Title Case.
  it("titles every page in sentence case", () => {
    const proper = /^(?:Openboard|Airtable|API|CRM|CFP|ICS|CSV|URL|AI)$/u;
    const titles = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      const text = readFileSync(path, "utf8");
      // The `<h1>` of an organizer screen, and the browser tab's own title.
      const headers = [...text.matchAll(/<PageHeader\b[^>]*?\btitle="([^"]+)"/gu)];
      const metadata = file.startsWith("app") && file.endsWith("page.tsx") ? [...text.matchAll(/\btitle: "([^"]+)"/gu)] : [];
      return [...headers, ...metadata].map((match) => ({ file, value: match[1] ?? "" }));
    });
    expect(titles.length).toBeGreaterThan(50);

    const titleCased = titles.filter(({ value }) => value
      .split(/[\s—–]+/u)
      .slice(1)
      .some((word) => /^[A-Z][a-z]+$/u.test(word) && !proper.test(word)));
    expect(titleCased.map(({ file, value }) => `${file}: ${value}`)).toEqual([]);
  });
});
