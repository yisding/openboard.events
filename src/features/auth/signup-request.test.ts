import { describe, expect, it, vi } from "vitest";
import { SIGNUP_EVENT_HEADER, SIGNUP_ORGANIZATION_HEADER } from "./signup-context";
import { beginGoogleSignup, signupAndAwaitVerification } from "./signup-request";

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

  it("keeps an unconsumed invitation available to duplicate-signup activation resends", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(signupAndAwaitVerification(input, request)).resolves.toEqual({
      destination: "/signup/check-email?email=new-owner%40example.com&next=%2Fjoin%3Ftoken%3Dconsumed-invitation-token",
      refresh: false,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps an accepted reviewer invitation on the event review destination for resends", async () => {
    const eventId = "00000000-0000-4000-8000-000000000010";
    const request = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 200,
      headers: {
        [SIGNUP_ORGANIZATION_HEADER]: organizationId,
        [SIGNUP_EVENT_HEADER]: eventId,
      },
    }));

    await expect(signupAndAwaitVerification(input, request)).resolves.toEqual({
      destination: `/signup/check-email?email=new-owner%40example.com&next=%2Fevents%2F${eventId}%2Freview`,
      refresh: false,
    });
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

describe("beginGoogleSignup", () => {
  it("posts the same workspace, invitation, destination, and policy versions", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(beginGoogleSignup({
      organizationName: "New Events",
      invitationToken: null,
      legalConsent: input.legalConsent,
      legalConsentAccepted: true,
      next: "/organizations",
    }, request)).resolves.toEqual({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" });
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      organizationName: "New Events",
      next: "/organizations",
      legalConsentAccepted: true,
      acceptedTermsVersion: "2026-08-12",
      acknowledgedPrivacyVersion: "2026-08-12",
    });
  });

  it("keeps server and transport failures in the signup form", async () => {
    const rejected = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Enter an organization name" },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    const base = {
      organizationName: "",
      invitationToken: null,
      legalConsent: null,
      legalConsentAccepted: false,
      next: "/organizations",
    };
    await expect(beginGoogleSignup(base, rejected)).resolves.toEqual({ error: "Enter an organization name" });
    await expect(beginGoogleSignup(base, vi.fn().mockRejectedValue(new TypeError("offline"))))
      .resolves.toEqual({ error: "Google signup is temporarily unavailable" });
  });

  it("rejects an insecure or malformed authorization destination", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "http://accounts.google.com/auth" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(beginGoogleSignup({
      organizationName: "New Events",
      invitationToken: null,
      legalConsent: null,
      legalConsentAccepted: false,
      next: "/organizations",
    }, request)).resolves.toEqual({ error: "Google signup is temporarily unavailable" });
  });
});
