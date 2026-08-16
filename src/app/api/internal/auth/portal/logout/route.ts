import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logoutPortal } from "@/features/auth";
import { assertSameOrigin } from "@/shared/server/csrf";
import { errorEnvelope } from "@/shared/server/handler";

const inputSchema = z.object({ eventSlug: z.string().min(1) });

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    await logoutPortal(input.eventSlug);
    return NextResponse.json({ data: { signedOut: true } });
  } catch (error) {
    // Every unrecognized throw used to answer 400 VALIDATION, so a genuine
    // internal failure here was reported to the caller — and to anyone reading
    // the logs — as a bad request.
    const { envelope, status, headers } = errorEnvelope(error, {
      requestId,
      feature: "portal-auth",
      route: "/api/internal/auth/portal/logout",
      fallbackMessages: { validation: "Invalid portal logout" },
    });
    return NextResponse.json(envelope, { status, headers });
  }
}
