import { NextRequest } from "next/server";
import { z } from "zod";
import { issuePortalToken } from "@/features/auth";
import { db } from "@/db/client";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, sessionContactId } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * M59 — "Calendar where they look." Minting the `ics_download` token behind a
 * click (not baking it into the server-rendered My Sessions page) keeps a
 * page view from being a write: every render of the portal home would
 * otherwise leave behind a fresh unconsumed 365-day token row, and the
 * speaker only ever wants one subscription URL. `/cal/[token]` (M35) already
 * serves the feed — this route only mints the credential that opens it.
 */
const requestFeedUrl = defineHandler({
  auth: portalQueryAuth,
  input: z.object({}),
  handler: async ({ eventId, session }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    const { raw } = await issuePortalToken(db, {
      contactId: sessionContactId(session),
      eventId: eventIdSchema.parse(eventId),
      purpose: "ics_download",
      ttl: "P365D",
    });
    return { url: `/cal/${encodeURIComponent(raw)}` };
  },
});

export const POST = (request: NextRequest) => requestFeedUrl(request);
