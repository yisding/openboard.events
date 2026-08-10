import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { exportContactData } from "@/features/data-lifecycle";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

/**
 * M47 — the contact half of "contact/org data export (JSON bundle per
 * contact and per organization)". Organizer-only, the same bar the sibling
 * `[contactId]` detail route sets: the bundle carries the same name/email
 * this codebase already treats as organizer-only PII, plus every message
 * ever sent to them and their submitted answer content.
 */
const get = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { contactId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const bundle = await exportContactData(scopedEventId, contactId);
    if (!bundle) throw new AppError("NOT_FOUND", "Speaker not found");
    return bundle;
  },
});

type Route = { params: Promise<{ eventId: string; contactId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}
