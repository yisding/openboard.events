import { describe, expect, it } from "vitest";
import { passwordResetLandingUrl } from "./password-reset-context";

describe("passwordResetLandingUrl", () => {
  it("keeps a safe invitation handoff while moving the reset token into the query", () => {
    const provider = "https://preview.example/api/auth/reset-password/provider-token"
      + "?callbackURL=%2Flogin%2Freset%3Fnext%3D%252Fjoin%253Ftoken%253Dinvite-123";

    const landing = passwordResetLandingUrl(provider, "reset-123");

    expect(landing.origin).toBe("https://preview.example");
    expect(landing.pathname).toBe("/login/reset");
    expect(landing.searchParams.get("token")).toBe("reset-123");
    expect(landing.searchParams.get("next")).toBe("/join?token=invite-123");
  });

  it("drops external and unsupported callbacks", () => {
    const external = passwordResetLandingUrl(
      "https://preview.example/api/auth/reset-password/provider-token?callbackURL=https%3A%2F%2Fattacker.example%2Fsteal",
      "reset-123",
    );
    const wrongPage = passwordResetLandingUrl(
      "https://preview.example/api/auth/reset-password/provider-token?callbackURL=%2Fevents%3Fnext%3D%252Fjoin%253Ftoken%253Dinvite-123",
      "reset-123",
    );

    expect(external.toString()).toBe("https://preview.example/login/reset?token=reset-123");
    expect(wrongPage.toString()).toBe("https://preview.example/login/reset?token=reset-123");
  });
});
