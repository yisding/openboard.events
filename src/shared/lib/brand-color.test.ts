import { describe, expect, it } from "vitest";
import { asAccentColor } from "./brand-color";

describe("asAccentColor", () => {
  it("keeps every hex form an organiser can type", () => {
    expect(asAccentColor("#00a878")).toBe("#00a878");
    expect(asAccentColor("  #0A8  ")).toBe("#0A8");
    expect(asAccentColor("#00a87880")).toBe("#00a87880");
  });

  it("rejects prose so the plain-text theme field cannot void --accent", () => {
    expect(asAccentColor("Frontiers of applied AI")).toBeNull();
    expect(asAccentColor("rebeccapurple")).toBeNull();
    expect(asAccentColor("")).toBeNull();
    expect(asAccentColor(null)).toBeNull();
    expect(asAccentColor(undefined)).toBeNull();
  });
});
