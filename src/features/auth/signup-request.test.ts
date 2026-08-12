import { describe, expect, it, vi } from "vitest";
import { SIGNUP_ORGANIZATION_HEADER } from "./signup-context";
import { signupWithImmediateSignIn } from "./signup-request";

const organizationId = "00000000-0000-4000-8000-000000000001";
const input = {
  email: "new-owner@example.com",
  password: "a-secure-password",
  name: "New Owner",
  organizationName: "New Events",
  invitationToken: "consumed-invitation-token",
  next: "/join?token=consumed-invitation-token",
};

function successfulSignup(): Response {
  return new Response(null, {
    status: 200,
    headers: { [SIGNUP_ORGANIZATION_HEADER]: organizationId },
  });
}

describe("signupWithImmediateSignIn", () => {
  it("continues to the organization after both signup steps succeed", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(successfulSignup())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(signupWithImmediateSignIn(input, request)).resolves.toEqual({
      destination: `/organizations/${organizationId}`,
      refresh: true,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["rejects", () => Promise.reject(new TypeError("offline"))],
    ["returns a failure", () => Promise.resolve(new Response(null, { status: 503 }))],
  ])("routes the already-created account to login when immediate sign-in %s", async (_label, signIn) => {
    const request = vi.fn()
      .mockResolvedValueOnce(successfulSignup())
      .mockImplementationOnce(signIn);

    await expect(signupWithImmediateSignIn(input, request)).resolves.toEqual({
      destination: `/login?next=${encodeURIComponent(`/organizations/${organizationId}`)}`,
      refresh: false,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe("/api/auth/sign-in");
  });

  it("keeps a signup rejection on the signup form with the server message", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "That email is already registered" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    }));

    await expect(signupWithImmediateSignIn(input, request)).resolves.toEqual({
      error: "That email is already registered",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps a signup network failure on the signup form", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("offline"));

    await expect(signupWithImmediateSignIn(input, request)).resolves.toEqual({
      error: "Signup is temporarily unavailable",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
