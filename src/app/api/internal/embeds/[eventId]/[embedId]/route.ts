import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { updateEmbedConfig } from "@/features/public/server/embed-config-mutations";
import { embedConfigPatchSchema } from "@/features/public/embed-config-types";
import { embedIdSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ embedId: embedIdSchema });

/** PATCH = toggle `enabled` and/or replace the `style` object (accent/theme/showHeader). */
const update = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: embedConfigPatchSchema,
  handler: async ({ eventId, input, params }) => {
    const { embedId } = routeParams.parse(params);
    return updateEmbedConfig(eventIdSchema.parse(eventId), embedId, input);
  },
});

type Route = { params: Promise<{ eventId: string; embedId: string }> };

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}
