import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import {
  AIRTABLE_MANUAL_BUDGET_MS,
  latestSyncRun,
  runAirtableSyncForEvent,
} from "@/features/airtable";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * "Sync now", and the 1500ms poll the panel watches it through.
 *
 * The POST runs the sync inline, inside the request, on a 15-second budget —
 * shorter than the cron run's 20s because a person is looking at a spinner.
 * Whatever it does not reach is counted and named ("118 to go"), not silently
 * dropped: `runAirtableSyncForEventIn` writes per-table stats after every
 * table, which is what makes the GET below return real numbers while the POST
 * is still in flight rather than a progress bar that is only theatre.
 *
 * This deliberately ignores `AIRTABLE_CRON`. That flag gates *scheduled*
 * pressure on Airtable's rate limits, not the feature — an organizer who
 * clicks a button gets a sync.
 */
const syncNow = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  rateLimit: {
    limit: 6,
    windowMs: 60_000,
    key: ({ eventId, session }) => `airtable-sync:${eventId ?? "none"}:${session?.actorId ?? "anon"}`,
  },
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    // A `CONFLICT` here means the partial unique index on
    // `(event_id) WHERE status = 'running'` refused a second live run. That is
    // the correct answer to a double-click and to a cron tick landing mid-click
    // alike, and the panel says so in words.
    await runAirtableSyncForEvent(eventId, { trigger: "manual", budgetMs: AIRTABLE_MANUAL_BUDGET_MS });
    return { run: await latestSyncRun(eventId) };
  },
});

const latest = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return { run: await latestSyncRun(eventId) };
  },
});

type Route = { params: Promise<{ eventId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return latest(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return syncNow(request, route);
}
