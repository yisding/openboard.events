import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import {
  airtableOptionsPatchSchema,
  disconnectAirtable,
  getAirtableConnection,
  listSyncRuns,
  updateAirtableOptions,
} from "@/features/airtable";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The Airtable connection itself: read it, change what it syncs, forget it.
 *
 * Nothing here can leak the personal access token. `getAirtableConnection`
 * returns an `AirtableConnectionSummary`, whose type has no field for a token,
 * a ciphertext, or a fingerprint — a careless `...row` spread would not
 * typecheck, which is a stronger guarantee than a review comment.
 */
const RUN_HISTORY_LIMIT = 10;

const status = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    const [connection, runs] = await Promise.all([
      getAirtableConnection(eventId),
      listSyncRuns(eventId, RUN_HISTORY_LIMIT),
    ]);
    return { connection, runs };
  },
});

// `updateAirtableOptionsIn` sets `next_sync_after = now()` on every patch, so a
// newly-included column backfills on the next scheduled run instead of waiting
// out the interval. Toggling a gate *off* is the same story in reverse: the
// projection starts emitting null for it and the next push clears the column.
const patchOptions = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: airtableOptionsPatchSchema.extend({ syncEnabled: z.boolean().optional() }),
  handler: async ({ eventId, input }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return updateAirtableOptions(eventId, input);
  },
});

const disconnect = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return disconnectAirtable(eventId);
  },
});

type Route = { params: Promise<{ eventId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return status(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return patchOptions(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return disconnect(request, route);
}
