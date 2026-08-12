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

  it("searches and previews the biography text people actually see", () => {
    const bioHtml = '<p><span title="5 > 3">R&amp;D&nbsp;agents</span></p>';
    expect(publicSpeakerPlainText(bioHtml)).toBe("R&D agents");
    expect(matchesPublicSpeakerSearch({ ...speaker, bioHtml }, "R&D")).toBe(true);
    expect(matchesPublicSpeakerSearch({ ...speaker, bioHtml }, "amp")).toBe(false);
  });
});
