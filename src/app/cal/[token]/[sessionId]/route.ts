import { db, type DbOrTx } from "@/db/client";
import { verifyPortalToken } from "@/features/auth";
import { buildCalendarDownloadIn, type CalendarTokenIdentity } from "@/features/comms/server/invites";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";

export const dynamic = "force-dynamic";

type VerifyCalendarToken = (
  raw: string,
  options: { purpose: "ics_download" },
) => Promise<CalendarTokenIdentity | null>;

type DownloadDependencies = { dbOrTx?: DbOrTx; env?: RuntimeEnv; verify?: VerifyCalendarToken };

export async function calendarDownloadResponse(
  token: string,
  sessionId: string,
  dependencies: DownloadDependencies = {},
): Promise<Response> {
  const identity = await (dependencies.verify ?? verifyPortalToken)(token, { purpose: "ics_download" });
  if (!identity) return Response.json({ error: { code: "NOT_FOUND", message: "Calendar not found" } }, { status: 404 });
  const body = await buildCalendarDownloadIn(
    dependencies.dbOrTx ?? db,
    identity,
    sessionId,
    dependencies.env ?? getEnv(),
  );
  if (!body) return Response.json({ error: { code: "NOT_FOUND", message: "Calendar not found" } }, { status: 404 });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"invite.ics\"",
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params;
  return calendarDownloadResponse(token, sessionId);
}
