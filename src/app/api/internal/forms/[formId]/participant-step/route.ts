import type { NextRequest } from "next/server";
import { withTx } from "@/db/client";
import { participantStepInputSchema } from "@/features/forms/participant-step";
import { updateParticipantStepWithReplayIn } from "@/features/forms/server/builder-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const update = defineHandler({
  auth: formBuilderAuth(),
  input: participantStepInputSchema,
  handler: async ({ eventId, input, params }) => {
    const { participantReplay = false, ...operation } = input;
    return withTx((tx) => updateParticipantStepWithReplayIn(
      tx,
      eventIdSchema.parse(eventId),
      formIdSchema.parse(params.formId),
      operation,
      participantReplay,
    ));
  },
});

export function PATCH(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return update(request, route);
}
