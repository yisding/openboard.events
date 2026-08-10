import { NextRequest } from "next/server";
import { z } from "zod";
import { getSpeakerProfile, profilePatchSchema, updateProfile } from "@/features/portal";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, sessionContactId } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * The speaker's own profile — bio, name/salutation, links, headshot. `PATCH` is
 * field-scoped: `updateProfile` only ever touches the columns present in the
 * request body, so a concurrent form-task write-back (M25) never gets clobbered
 * by an unrelated save here, and vice versa (edge case #5). The bio is sanitized
 * at this write boundary (resolution #2), not trusted from the editor.
 */
const getMine = defineHandler({
  auth: portalQueryAuth,
  input: z.object({ eventId: eventIdSchema }),
  handler: async ({ input, session }) => getSpeakerProfile(input.eventId, sessionContactId(session)),
});

const patchMine = defineHandler({
  auth: portalQueryAuth,
  input: profilePatchSchema,
  handler: async ({ eventId, session, input }) => updateProfile(eventIdSchema.parse(eventId), sessionContactId(session), input),
});

export const GET = (request: NextRequest) => getMine(request);
export const PATCH = (request: NextRequest) => patchMine(request);
