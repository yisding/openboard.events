import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { updateEmbedConfig } from "@/features/public/server/embed-config-mutations";
import { embedConfigPatchSchema } from "@/features/public/embed-config-types";
import { embedIdSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEmbed } from "@/shared/server/revalidate-public";

const routeParams = z.object({ embedId: embedIdSchema });

/**
 * PATCH = toggle `enabled` and/or replace the `style` object
 * (accent/theme/showHeader) and/or the content `filters`. Revalidates the
 * one `/embed/[slug]/<route>` page this config affects so a save takes
 * effect immediately — see `revalidatePublicEmbed`'s doc: without this, a
 * style/filter/kill-switch change would sit behind the route's own
 * `revalidate = 60` window instead of applying "right after this save" the
 * way the embeds admin page promises.
 */
const update = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: embedConfigPatchSchema,
  handler: async ({ eventId, input, params, requestId }) => {
    const { embedId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const updated = await updateEmbedConfig(scopedEventId, embedId, input);
    await revalidatePublicEmbed(scopedEventId, updated.contentType, requestId);
    return updated;
  },
});

type Route = { params: Promise<{ eventId: string; embedId: string }> };

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}
