import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { composeBulkSpeakerEmail, nudgeOutboxAfterCommit } from "@/features/comms";
import { composeBulkSpeakerEmailInputSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * M51 — personalized bulk speaker email (work order step 6). One route for
 * both halves: `mode: "preview"` resolves one recipient's merged content and
 * queues nothing, `mode: "send"` enqueues one `speaker_bulk_message` per
 * surviving recipient through the ordinary outbox (`enqueueEmail` only — no
 * direct Resend/communication-log write, per guardrail).
 */
const compose = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: composeBulkSpeakerEmailInputSchema,
  handler: async ({ eventId, input }) => {
    const result = await composeBulkSpeakerEmail(eventIdSchema.parse(eventId), input);
    // Start delivering now; the fifteen-minute outbox sweep recovers whatever
    // the nudge's one bounded claim does not reach.
    if (input.mode === "send") nudgeOutboxAfterCommit();
    return result;
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return compose(request, route);
}
