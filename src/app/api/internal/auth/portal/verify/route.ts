import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyPortalLogin } from "@/features/auth";
import { assertSameOrigin } from "@/shared/server/csrf";
import { errorEnvelope } from "@/shared/server/handler";

const inputSchema = z.object({
  eventSlug: z.string().min(1),
  token: z.string().min(1).optional(),
  code: z.string().regex(/^\d{6}$/u).optional(),
  email: z.email().optional(),
  impersonate: z.boolean().default(false),
}).superRefine((input, context) => {
  if (!input.token && !(input.code && input.email)) context.addIssue({ code: "custom", message: "token or email and code are required" });
  if (input.impersonate && !input.token) context.addIssue({ code: "custom", message: "impersonation requires a token" });
});

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    const session = await verifyPortalLogin({
      eventSlug: input.eventSlug,
      ...(input.token ? { raw: input.token } : {}),
      ...(input.code ? { code: input.code } : {}),
      ...(input.email ? { email: input.email } : {}),
      impersonate: input.impersonate,
    });
    return NextResponse.json({ data: { eventId: session.eventId, contactId: session.contactId, alreadySignedIn: session.alreadySignedIn ?? false } });
  } catch (error) {
    const { envelope, status, headers } = errorEnvelope(error, {
      requestId,
      feature: "portal-auth",
      route: "/api/internal/auth/portal/verify",
      fallbackMessages: { validation: "Enter a valid code", internal: "Unable to verify sign in" },
    });
    return NextResponse.json(envelope, { status, headers });
  }
}
