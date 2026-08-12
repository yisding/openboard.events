import { describe, expect, it } from "vitest";
import { portalOtpFromHtml, verificationLinkFromHtml } from "../../e2e/helpers/admin-auth-mail";

describe("self-service E2E sent-email reader", () => {
  it("extracts and decodes the Better Auth action without choosing layout links", () => {
    const html = `
      <a href="https://openboard.example/">Openboard</a>
      <a href="https://preview.example/api/auth/verify-email?token=secret&amp;callbackURL=%2Fsignup%2Fverified">Confirm</a>
    `;
    expect(verificationLinkFromHtml(html))
      .toBe("https://preview.example/api/auth/verify-email?token=secret&callbackURL=%2Fsignup%2Fverified");
  });

  it("rejects links that do not carry a verification token", () => {
    expect(verificationLinkFromHtml('<a href="https://preview.example/api/auth/verify-email">Confirm</a>')).toBeNull();
    expect(verificationLinkFromHtml('<a href="https://preview.example/login">Sign in</a>')).toBeNull();
  });

  it("extracts the portal OTP from its sentence without choosing layout numbers", () => {
    const html = `
      <style>.shell { color: #121212; width: 600px; }</style>
      <p>Your sign-in code is <strong>482913</strong>.</p>
      <p>Copyright 2026</p>
    `;
    expect(portalOtpFromHtml(html)).toBe("482913");
  });

  it("does not treat an unrelated six-digit value as a portal OTP", () => {
    expect(portalOtpFromHtml("<p>Reference 482913</p>")).toBeNull();
  });
});
