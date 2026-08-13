import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("page title regressions", () => {
  it("gives every directly rendered embed surface a descriptive title", () => {
    const pages = [
      ["./embed/[eventSlug]/agenda/page.tsx", "Agenda"],
      ["./embed/[eventSlug]/gallery/page.tsx", "Speaker gallery"],
      ["./embed/[eventSlug]/itinerary/page.tsx", "Schedule itinerary"],
      ["./embed/[eventSlug]/sessions/page.tsx", "Sessions"],
      ["./embed/[eventSlug]/speakers/page.tsx", "Speakers"],
    ] as const;

    for (const [path, title] of pages) {
      expect(read(path), path).toContain(`export const metadata: Metadata = { title: "${title}" }`);
    }
  });

  it("names portal verification and email-preference documents", () => {
    expect(read("./portal/[eventSlug]/verify/page.tsx")).toContain('title: "Confirm portal sign in"');
    expect(read("./portal/[eventSlug]/unsubscribe/page.tsx")).toContain('title: "Email preferences"');
  });
});
