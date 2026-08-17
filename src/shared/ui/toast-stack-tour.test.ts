import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The guided tour's coach card and the toast stack both rest against the
 * viewport's bottom edge — the card can dock as low as `COACH_CLEARANCE`
 * (provider.tsx) and the stack is fixed 24px up — so a save toast fired while
 * a card is on screen can land squarely on the card's own Done/Next row
 * (#716). The fix is presentational and keyed off `.tour-coach` (coach.tsx's
 * root class) so it only ever changes anything while a card is actually
 * mounted; every other toast keeps its usual resting place.
 */
describe("toast stack clears a docked tour card", () => {
  it("lifts the stack while a coach card is mounted, and only then", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toContain(".toast-stack{position:fixed;z-index:200;inset:auto auto 24px 50%");
    expect(css).toContain("body:has(.tour-coach) .toast-stack{bottom:300px}");
  });
});
