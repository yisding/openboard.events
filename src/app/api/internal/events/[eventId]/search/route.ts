import { z } from "zod";
import type { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { searchEventEntities } from "@/features/shell/server/search";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

/**
 * M58 — the command palette's entity-jump backend. Any member may search
 * (a reviewer looking up a submission by code is a legitimate palette use),
 * same access rule as the Abstracts table itself.
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
