import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  confirmAdminEmail,
  emailConfirmationLandingUrl,
  handleAdminAuthGet,
} from "@/app/api/auth/[...action]/_lib";

const VERIFY_URL = "https://preview.example/api/auth/verify-email?token=secret-token&callbackURL=%2Fsignup%2Fverified%3Fconfirmed%3D1%26next%3D%252Forganizations%252F00000000-0000-4000-8000-000000000001";

describe("scanner-safe admin email confirmation", () => {
  it("turns the provider GET into a confirmation page with a safe final destination", () => {
    const landing = emailConfirmationLandingUrl(VERIFY_URL);

    expect(landing.origin).toBe("https://preview.example");
    expect(landing.pathname).toBe("/signup/confirm");
    expect(landing.searchParams.get("token")).toBe("secret-token");
    expect(landing.searchParams.get("next")).toBe("/organizations/00000000-0000-4000-8000-000000000001");

    const external = emailConfirmationLandingUrl("https://preview.example/api/auth/verify-email?token=x&callbackURL=https%3A%2F%2Fattacker.example%2Fsteal");
    expect(external.searchParams.get("next")).toBe("/organizations");
  });

  it("does not invoke Better Auth when a scanner follows the emailed GET", async () => {
    const handler = vi.fn();
    const response = await handleAdminAuthGet(new NextRequest(VERIFY_URL), true, handler);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/signup/confirm?");
    expect(handler).not.toHaveBeenCalled();
  });

  it("consumes the token and carries the session cookie only after the explicit POST", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "openboard_admin.session_token=session-secret; Path=/; HttpOnly; Secure; SameSite=Lax",
      },
    }));
    const limit = vi.fn().mockResolvedValue(undefined);
    const body = new URLSearchParams({
      token: "secret-token",
      next: "/organizations/00000000-0000-4000-8000-000000000001",
    });
    const request = new NextRequest("https://preview.example/api/auth/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const response = await confirmAdminEmail(request, { handler, limit });

    expect(limit).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    const forwarded = handler.mock.calls[0]?.[0] as Request;
    expect(forwarded.method).toBe("GET");
    expect(new URL(forwarded.url).pathname).toBe("/api/auth/verify-email");
    expect(new URL(forwarded.url).searchParams.get("token")).toBe("secret-token");
    expect(forwarded.headers.get("content-type")).toBeNull();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://preview.example/organizations/00000000-0000-4000-8000-000000000001");
    expect(response.headers.getSetCookie()).toEqual([
      "openboard_admin.session_token=session-secret; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
  });
});
