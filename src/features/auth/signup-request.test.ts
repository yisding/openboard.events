import { describe, expect, it, vi } from "vitest";
import { SIGNUP_ORGANIZATION_HEADER } from "./signup-context";
import { signupAndAwaitVerification } from "./signup-request";

const organizationId = "00000000-0000-4000-8000-000000000001";
const input = {
  email: "new-owner@example.com",
  password: "a-secure-password",
  name: "New Owner",
  organizationName: "New Events",
  invitationToken: "consumed-invitation-token",
  legalConsent: {
    termsUrl: "https://example.com/terms",
    termsVersion: "2026-08-12",
    privacyUrl: "https://example.com/privacy",
    privacyVersion: "2026-08-12",
  },
  legalConsentAccepted: true,
  next: "/join?token=consumed-invitation-token",
};

function successfulSignup(): Response {
  return new Response(null, {
    status: 200,
    headers: { [SIGNUP_ORGANIZATION_HEADER]: organizationId },
  });
}

describe("signupAndAwaitVerification", () => {
  it("continues to a check-inbox step without creating a session", async () => {
    const request = vi.fn().mockResolvedValueOnce(successfulSignup());

    await expect(signupAndAwaitVerification(input, request)).resolves.toEqual({
      destination: `/signup/check-email?email=new-owner%40example.com&next=%2Forganizations%2F${organizationId}`,
      refresh: false,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      callbackURL: "/signup/verified?confirmed=1&next=%2Forganizations",
      legalConsentAccepted: true,
      acceptedTermsVersion: "2026-08-12",
      acknowledgedPrivacyVersion: "2026-08-12",
    });
  });

  it("omits policy fields when the deployment has not activated reviewed copy", async () => {
    const request = vi.fn().mockResolvedValueOnce(successfulSignup());

    await signupAndAwaitVerification({ ...input, legalConsent: null, legalConsentAccepted: false }, request);

    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("legalConsentAccepted");
    expect(body).not.toHaveProperty("acceptedTermsVersion");
    expect(body).not.toHaveProperty("acknowledgedPrivacyVersion");
  });

  it("does not revisit a consumed invitation when a generic signup response has no organization header", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(signupAndAwaitVerification(input, request)).resolves.toEqual({
      destination: "/signup/check-email?email=new-owner%40example.com&next=%2Forganizations",
      refresh: false,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps a signup rejection on the signup form with the server message", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "That email is already registered" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    }));

    await expect(signupAndAwaitVerification(input, request)).resolves.toEqual({
      error: "That email is already registered",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps a signup network failure on the signup form", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("offline"));

    await expect(signupAndAwaitVerification(input, request)).resolves.toEqual({
      error: "Signup is temporarily unavailable",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
