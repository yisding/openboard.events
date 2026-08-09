import { calendarDownloadResponse } from "../../_responses";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; sessionId: string }> },
) {
  const { token, sessionId } = await params;
  return calendarDownloadResponse(token, sessionId);
}
