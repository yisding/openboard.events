import { z } from "zod";
import type { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { searchEventEntities } from "@/features/shell/server/search";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

/**
 * M58 — the command palette's entity-jump backend.
 *
 * Organizer-only, and deliberately so: every result links into a view that is
 * itself organizer-only (the Abstracts table, the speaker roster, the agenda),
 * so widening the guard here would answer a reviewer with a list of places they
 * cannot go. `adminAuth()`'s unnamed default is that organizer role — the
 * fail-closed one `guards.ts` describes — not an oversight.
 *
 * The palette knows this and offers a reviewer the verb list alone, so nothing
 * should be reaching this route with a reviewer's session.
 */
const searchHandler = defineHandler({
  auth: adminAuth(),
  input: z.object({ q: z.string().max(200).default("") }),
  handler: async ({ eventId, input }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return searchEventEntities(eventId, input.q);
  },
});

export function GET(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  return searchHandler(request, context);
}
