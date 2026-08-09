import { z } from "zod";
import type { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { getOverview } from "@/features/dashboard";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const getOverviewHandler = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return getOverview(eventId);
  },
});

export function GET(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  return getOverviewHandler(request, context);
}
