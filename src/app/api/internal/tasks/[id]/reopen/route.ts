import { z } from "zod";
import type { NextRequest } from "next/server";
import { contactIdSchema, eventIdSchema, submissionIdSchema, taskIdSchema } from "@/shared/contracts";
import { db } from "@/db/client";
import { tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { reopenCompletionIn } from "@/features/portal/tasks-admin/server/mutations";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ id: taskIdSchema });
const reopenInput = z.object({ contactId: contactIdSchema, submissionId: submissionIdSchema.nullable() });

/**
 * Admin-only "undo" of one completion. This never inserts into
 * `task_completions` — see `reopenCompletionIn` — and reminders do not resume
 * with a fresh ladder afterward (data-model.md §4.3), documented behavior, not
 * a bug this route needs to work around.
 */
const reopen = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: reopenInput,
  handler: async ({ eventId, input, params }) => {
    const { id } = routeParams.parse(params);
    await reopenCompletionIn(db, eventIdSchema.parse(eventId), id, input.contactId, input.submissionId);
    return { ok: true };
  },
});

export function POST(request: NextRequest, route: { params: Promise<{ id: string }> }): Promise<Response> {
  return reopen(request, route);
}
