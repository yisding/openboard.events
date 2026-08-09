import { db, type DbOrTx } from "@/db/client";
import { verifyPortalToken } from "@/features/auth";
import { buildCalendarFeedIn, type CalendarTokenIdentity } from "@/features/comms/server/invites";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";

export const dynamic = "force-dynamic";

type VerifyCalendarToken = (
  raw: string,
  options: { purpose: "ics_download" },
) => Promise<CalendarTokenIdentity | null>;

type FeedDependencies = { dbOrTx?: DbOrTx; env?: RuntimeEnv; verify?: VerifyCalendarToken };

export async function calendarFeedResponse(token: string, dependencies: FeedDependencies = {}): Promise<Response> {
  const identity = await (dependencies.verify ?? verifyPortalToken)(token, { purpose: "ics_download" });
  if (!identity) return Response.json({ error: { code: "NOT_FOUND", message: "Calendar not found" } }, { status: 404 });
  const body = await buildCalendarFeedIn(
    dependencies.dbOrTx ?? db,
    identity,
    dependencies.env ?? getEnv(),
  );
  if (!body) return Response.json({ error: { code: "NOT_FOUND", message: "Calendar not found" } }, { status: 404 });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return calendarFeedResponse(token);
}
