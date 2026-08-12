import { describe, expect, it } from "vitest";
import { verificationLinkFromHtml } from "../../e2e/helpers/admin-auth-mail";

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
});
