import { z } from "zod";
import { db } from "@/db/client";
import { sendRemindersNow } from "@/features/comms";
import {
  contactIdSchema,
  fileRequestIdSchema,
  submissionIdSchema,
  taskIdSchema,
  type EventId,
  type FileCommentDTO,
  type UserId,
} from "@/shared/contracts";
import { addFileCommentIn } from "../../server/deliverable-slot";
import { DELIVERABLE_BULK_LIMIT } from "../bulk-limit";

/**
 * The organizer's half of a deliverable's comment thread. The speaker's half
 * (`addTaskComment`) resolves `fileRequestId` from a task id it already
 * authorized; the organizer's central Files view already has the slot's
 * three coordinates from the row it is showing, so it supplies them directly
 * — both paths land on the same `addFileCommentIn` writer.
 */
export const organizerCommentInputSchema = z.object({
  fileRequestId: fileRequestIdSchema,
  contactId: contactIdSchema,
  submissionId: submissionIdSchema.nullable().default(null),
  body: z.string().trim().min(1).max(5_000),
});
export type OrganizerCommentInput = z.infer<typeof organizerCommentInputSchema>;

export function addOrganizerComment(eventId: EventId, actorUserId: UserId, input: OrganizerCommentInput): Promise<FileCommentDTO> {
  return addFileCommentIn(
    db, eventId, input.fileRequestId, input.contactId, input.submissionId,
    { role: "organizer", userId: actorUserId }, input.body,
  );
}

/** The central Files view's bulk bar: remind every selected, still-open row. */
export const bulkRemindInputSchema = z.object({
  targets: z.array(z.object({
    taskId: taskIdSchema,
    contactId: contactIdSchema,
    submissionId: submissionIdSchema.nullable(),
  })).min(1).max(DELIVERABLE_BULK_LIMIT),
});
export type BulkRemindInput = z.infer<typeof bulkRemindInputSchema>;

export function bulkRemind(eventId: EventId, input: BulkRemindInput): Promise<{ enqueued: number; total: number }> {
  return sendRemindersNow(eventId, input.targets);
}
