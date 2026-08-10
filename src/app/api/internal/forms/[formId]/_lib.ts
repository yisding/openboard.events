import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { forms } from "@/db/schema";
import { portalAuth } from "@/features/auth";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { AuthGuard } from "@/shared/server/handler";

/** Resolve the event from the route-owned form before authenticating the portal session. */
export const formPortalAuth: AuthGuard = async (request, _eventId, params) => {
  const formId = formIdSchema.parse(params.formId);
  const [form] = await db.select({ eventId: forms.eventId })
    .from(forms)
    .where(eq(forms.id, formId))
    .limit(1);
  if (!form) throw new AppError("NOT_FOUND", "Form not found");

  const eventId = eventIdSchema.parse(form.eventId);
  const session = await portalAuth()(request, eventId, params);
  if (!session) return null;
  return { ...session, eventId };
};
