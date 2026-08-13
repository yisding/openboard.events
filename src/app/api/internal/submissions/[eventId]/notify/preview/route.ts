import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { previewNotifyQueues } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const preview = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => previewNotifyQueues(eventIdSchema.parse(eventId)),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return preview(request, route);
}
