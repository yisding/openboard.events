import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { renderTemplateContent } from "@/features/comms";
import { SAMPLE_VARS } from "@/features/comms/index.templates";
import { templateKeySchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const previewInputSchema = z.object({
  key: templateKeySchema,
  subject: z.string().max(300),
  bodyHtml: z.string().max(50_000),
});

/**
 * The Templates tab's live preview (step 3): `renderTemplateContent` against a
 * fixture context, run server-side so the editor — a "use client" component —
 * never has to import the renderer (and the Drizzle schema graph behind it)
 * into the browser bundle. Unknown-variable rejection is the same
 * `TEMPLATE_VAR_MISSING` 400 the save path returns.
 */
const preview = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: previewInputSchema,
  handler: async ({ input }) => renderTemplateContent(input.key, input.subject, input.bodyHtml, SAMPLE_VARS[input.key]),
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return preview(request, route);
}
