import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("page title regressions", () => {
  /**
   * First Fair (design §6.3) turned these five static `metadata` constants
   * into `generateMetadata`, because a demo event's embed has to answer
   * `robots: { index: false }` and a constant cannot read the event row. The
   * title is still the thing being protected here — a surface that renders
   * directly in a browser tab and inherits the root layout's title is the
   * regression — so this pins the title inside whichever form the page uses,
   * and separately pins that the dynamic form is still exported.
   */
  it("gives every directly rendered embed surface a descriptive title", () => {
    const pages = [
      ["./embed/[eventSlug]/agenda/page.tsx", "Agenda"],
      ["./embed/[eventSlug]/gallery/page.tsx", "Speaker gallery"],
      ["./embed/[eventSlug]/itinerary/page.tsx", "Schedule itinerary"],
      ["./embed/[eventSlug]/sessions/page.tsx", "Sessions"],
      ["./embed/[eventSlug]/speakers/page.tsx", "Speakers"],
    ] as const;

    for (const [path, title] of pages) {
      const source = read(path);
      expect(source, path).toContain(`title: "${title}"`);
      expect(source, `${path} must resolve its metadata per request so a demo event can be de-indexed`)
        .toContain("export async function generateMetadata(");
    }
  });

  it("names portal verification and email-preference documents", () => {
    expect(read("./portal/[eventSlug]/verify/page.tsx")).toContain('title: "Confirm portal sign in"');
    expect(read("./portal/[eventSlug]/unsubscribe/page.tsx")).toContain('title: "Email preferences"');
  });
});
