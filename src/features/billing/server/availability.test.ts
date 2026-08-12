import { describe, expect, it } from "vitest";
import { billingSurfaceUnavailableResponse, isBillingSurfaceEnabled } from "./availability";

describe("billing launch availability", () => {
  it("is disabled by default and can only expose the scaffold locally", () => {
    expect(isBillingSurfaceEnabled({ APP_ENV: "local", BILLING_MODE: "disabled" })).toBe(false);
    expect(isBillingSurfaceEnabled({ APP_ENV: "preview", BILLING_MODE: "scaffold" })).toBe(false);
    expect(isBillingSurfaceEnabled({ APP_ENV: "production", BILLING_MODE: "scaffold" })).toBe(false);
    expect(isBillingSurfaceEnabled({ APP_ENV: "local", BILLING_MODE: "scaffold" })).toBe(true);
  });

  it("uses the normal API error envelope when disabled", async () => {
    const response = billingSurfaceUnavailableResponse();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Billing is not available" },
    });
  });
});
