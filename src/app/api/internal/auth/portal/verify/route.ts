import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyPortalLogin } from "@/features/auth";
import { isAppError, toHttp } from "@/shared/lib/errors";
import { assertSameOrigin } from "@/shared/server/csrf";

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
    if (isAppError(error)) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: toHttp(error.code) });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: "Enter a valid code" } }, { status: 400 });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Unable to verify sign in" } }, { status: 500 });
  }
}
