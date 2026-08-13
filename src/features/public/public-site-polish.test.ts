import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/favicon.ico/route";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("public site polish", () => {
  it("ships the product mark and redirects conventional favicon requests to it", () => {
    const icon = read("../../app/icon.svg");
    const response = GET(new Request("https://openboard.events/favicon.ico"));

    expect(icon).toContain('id="openboard-mark"');
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://openboard.events/icon.svg");
  });

  it("keeps anonymous recovery and first-time portal language attendee-friendly", () => {
    const notFound = read("../../app/not-found.tsx");
    const portal = read("../portal/components/home/portal-home-widgets.tsx");
    const draftHero = read("../portal/components/home/speaker-home-hero.tsx");
    const layout = read("../../app/layout.tsx");

    expect(notFound).toContain('href="/"');
    expect(notFound).not.toContain('href="/events"');
    expect(portal).not.toContain("Welcome back");
    expect(draftHero).not.toContain("Welcome back");
    expect(layout).toContain("preload: false");
  });
});
