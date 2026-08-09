import type { NextRequest } from "next/server";
import { unsubscribeFromReminders } from "@/features/comms/server/unsubscribe";

export async function POST(request: NextRequest, { params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const form = await request.formData();
  const token = form.get("token");
  const unsubscribed = typeof token === "string" && await unsubscribeFromReminders(eventSlug, token);
  const destination = `/portal/${encodeURIComponent(eventSlug)}/unsubscribe?${unsubscribed ? "done=1" : "error=1"}`;
  return Response.redirect(new URL(destination, request.url), 303);
}
