import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("review queue request feedback", () => {
  it("reports both HTTP and transport failures as errors for saves and recusals", () => {
    const source = readFileSync(new URL("./review-queue-view.tsx", import.meta.url), "utf8");

    expect(source).toContain('"That score did not save", { kind: "error" }');
    expect(source).toContain('"Could not reach the server. Your review was not saved.", { kind: "error" }');
    expect(source).toContain('"That recusal did not save", { kind: "error" }');
    expect(source).toContain('"Could not reach the server. Your recusal was not saved.", { kind: "error" }');
  });
});
