import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import {
  airtableBaseChoiceInputSchema,
  chooseAirtableBase,
  listAirtableBases,
  type AirtableSchemaReport,
} from "@/features/airtable";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Step 2 of the connect flow: which base, and does it have the right shape.
 *
 * Both verbs open the sealed token server-side rather than accepting one — the
 * browser handed over a token exactly once, at `…/airtable/token`, and never
 * holds it again.
 */

/**
 * `EnsureSchemaResult` carries an `AirtableSchemaSnapshot` on its success arm:
 * every table and field id in the customer's base. The panel renders none of
 * it, so it does not cross the wire. What the panel needs is what it says here.
 */
function reportSchema(schema: Awaited<ReturnType<typeof chooseAirtableBase>>["schema"]): AirtableSchemaReport {
  return schema.ok
    ? { ok: true, reason: null, issues: [], createdTables: schema.createdTables, createdFields: schema.createdFields }
    : { ok: false, reason: schema.reason, issues: schema.issues, createdTables: 0, createdFields: 0 };
}

// Rate limited despite being a GET, and despite the organizer already being
// authenticated: `listAirtableBases` opens the sealed PAT and calls Airtable's
// meta API with the *customer's* token, up to ten pages of it. Airtable's limits
// are per token, so an organizer holding down refresh here spends a budget the
// scheduled sync needs — the 429s would land on the runs, not on this handler.
// The `choose` verb below has always been limited for the same reason.
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  rateLimit: {
    limit: 12,
    windowMs: 60_000,
    key: ({ eventId, session }) => `airtable-bases-list:${eventId ?? "none"}:${session?.actorId ?? "anon"}`,
  },
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return { bases: await listAirtableBases(eventId) };
  },
});

// Also the "Rebuild it" action on a blocked connection: re-selecting the base
// already attached re-runs `ensureBaseSchema`, which is create-only and never
// renames, retypes, or deletes. Running it twice costs meta calls and nothing
// else.
const choose = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: airtableBaseChoiceInputSchema,
  rateLimit: {
    limit: 12,
    windowMs: 60_000,
    key: ({ eventId, session }) => `airtable-base:${eventId ?? "none"}:${session?.actorId ?? "anon"}`,
  },
  handler: async ({ eventId, input }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    const { summary, created, schema } = await chooseAirtableBase(eventId, input);
    return { connection: summary, created, schema: reportSchema(schema) };
  },
});

type Route = { params: Promise<{ eventId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return choose(request, route);
}
