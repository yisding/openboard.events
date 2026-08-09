import { db, type DbOrTx } from "@/db/client";
import { verifyPortalToken } from "@/features/auth";
import {
  buildCalendarDownloadIn,
  buildCalendarFeedIn,
  type CalendarTokenIdentity,
} from "@/features/comms/server/invites";
import { sessionIdSchema } from "@/shared/contracts";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";

type VerifyCalendarToken = (
  raw: string,
  options: { purpose: "ics_download" },
) => Promise<CalendarTokenIdentity | null>;

export type CalendarResponseDependencies = {
  dbOrTx?: DbOrTx;
  env?: RuntimeEnv;
  verify?: VerifyCalendarToken;
};

function notFound(): Response {
  return Response.json({ error: { code: "NOT_FOUND", message: "Calendar not found" } }, { status: 404 });
}

export async function calendarFeedResponse(
  token: string,
  dependencies: CalendarResponseDependencies = {},
): Promise<Response> {
  const identity = await (dependencies.verify ?? verifyPortalToken)(token, { purpose: "ics_download" });
  if (!identity) return notFound();
  const body = await buildCalendarFeedIn(
    dependencies.dbOrTx ?? db,
    identity,
    dependencies.env ?? getEnv(),
  );
  if (!body) return notFound();
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function calendarDownloadResponse(
  token: string,
  rawSessionId: string,
  dependencies: CalendarResponseDependencies = {},
): Promise<Response> {
  const parsedSessionId = sessionIdSchema.safeParse(rawSessionId);
  if (!parsedSessionId.success) return notFound();
  const identity = await (dependencies.verify ?? verifyPortalToken)(token, { purpose: "ics_download" });
  if (!identity) return notFound();
  const body = await buildCalendarDownloadIn(
    dependencies.dbOrTx ?? db,
    identity,
    parsedSessionId.data,
    dependencies.env ?? getEnv(),
  );
  if (!body) return notFound();
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"invite.ics\"",
      "Cache-Control": "private, max-age=300",
    },
  });
}
