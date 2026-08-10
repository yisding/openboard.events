import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listEmbedConfigs } from "@/features/public/server/embed-config-queries";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

/** GET = both canonical embed configs for the event, creating any missing default row. */
const list = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId }) => listEmbedConfigs(eventIdSchema.parse(eventId)),
});

type Route = { params: Promise<{ eventId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}
