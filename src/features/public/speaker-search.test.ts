import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLISHED_SPEAKERS_FIXTURE } from "@/shared/fixtures/sessions";
import { matchesPublicSpeakerSearch, publicSpeakerPlainText } from "./speaker-search";

const [speaker] = PUBLISHED_SPEAKERS_FIXTURE.speakers;
if (!speaker) throw new Error("fixture must carry a speaker");

describe("public speaker search", () => {
  it("matches identity, biography, and session topics", () => {
    for (const query of ["Ada", "Analytical Engines", "Principal", "Computing pioneer", "Agents", "AI Agents", "Talk"]) {
      expect(matchesPublicSpeakerSearch(speaker, query), query).toBe(true);
    }
    expect(matchesPublicSpeakerSearch(speaker, "Kubernetes")).toBe(false);
  });

  it("matches query tokens across different public fields", () => {
    expect(matchesPublicSpeakerSearch(speaker, "Ada Agents Talk")).toBe(true);
    expect(matchesPublicSpeakerSearch(speaker, "   ")).toBe(true);
  });

  it("searches and previews biography text without exposing markup", () => {
    expect(publicSpeakerPlainText("<p>Reliable <strong>agents</strong></p>")).toBe("Reliable agents");
  });

  it("wires the same predicate into the list and gallery", () => {
    for (const file of ["./public-speakers-list.tsx", "./public-speaker-gallery.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("matchesPublicSpeakerSearch(speaker, search)");
    }
  });
});
