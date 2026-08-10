import { describe, expect, it } from "vitest";
import { accentTextShade } from "./public-event-shell";

function contrastOnWhite(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 1.05 / (0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) + 0.05);
}

describe("accentTextShade", () => {
  it("darkens the default jade accent until it clears AA on white", () => {
    const shade = accentTextShade("#00a878");
    expect(shade).not.toBe("#00a878");
    expect(contrastOnWhite(shade)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps already contrast-safe accents unchanged", () => {
    expect(accentTextShade("#007454")).toBe("#007454");
    expect(accentTextShade("#2a6486")).toBe("#2a6486");
  });

  it("normalizes every hex format the embed query parser accepts", () => {
    // #0a8 expands to #00aa88 (2.86:1 on white) and must darken.
    expect(contrastOnWhite(accentTextShade("#0a8"))).toBeGreaterThanOrEqual(4.5);
    // Alpha composites over the white embed ground before the check.
    expect(contrastOnWhite(accentTextShade("#00a878cc"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastOnWhite(accentTextShade("#0a8c"))).toBeGreaterThanOrEqual(4.5);
  });

  it("passes through values it cannot parse", () => {
    expect(accentTextShade("rebeccapurple")).toBe("rebeccapurple");
  });

  it("terminates on the worst case", () => {
    expect(contrastOnWhite(accentTextShade("#ffffff"))).toBeGreaterThanOrEqual(4.5);
  });
});
