import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createFileExportJob, processFileExportJob } from "@/features/portal/deliverables";
import { tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { contactIdSchema, eventIdSchema, submissionIdSchema, taskIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const createInput = z.object({
  targets: z.array(z.object({
    taskId: taskIdSchema,
    contactId: contactIdSchema,
    submissionId: submissionIdSchema.nullable(),
  })).min(1).max(200),
  groupBy: z.enum(["none", "session", "speaker"]).default("none"),
});

/**
 * Creates the job (server-derived latest-file selection, frozen) and kicks
 * off processing through `ctx.waitUntil` — the same fire-and-forget pattern
 * `nudgeOutbox` uses — so the response returns immediately with a `pending`
 * job the client polls via GET below.
 */
const create = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: createInput,
  handler: async ({ eventId, session, input }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const actorUserId = session?.actorId ? userIdSchema.parse(session.actorId) : null;
    const job = await createFileExportJob(scopedEventId, actorUserId, input.targets, input.groupBy);
    try {
      const ctx = getCloudflareContext().ctx;
      ctx.waitUntil(processFileExportJob(scopedEventId, job.id).catch(() => undefined));
    } catch {
      // No Worker context (tests, `next dev`) — the job stays `pending` until
      // a caller polls it through a context that has one, or processes it
      // directly (the GET route below does this as a fallback).
    }
    return job;
  },
});

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
