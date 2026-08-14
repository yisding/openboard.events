import { z } from "zod";
import { db } from "@/db/client";
import { sendRemindersNow } from "@/features/comms";
import {
  BULK_REMINDER_TARGET_LIMIT,
  contactIdSchema,
  bulkReminderTargetSchema,
  fileCommentIdSchema,
  fileRequestIdSchema,
  submissionIdSchema,
  type BulkReminderResult,
  type EventId,
  type FileCommentDTO,
  type UserId,
} from "@/shared/contracts";
import { addFileCommentIn } from "../../server/deliverable-slot";

/**
 * The organizer's half of a deliverable's comment thread. The speaker's half
 * (`addTaskComment`) resolves `fileRequestId` from a task id it already
 * authorized; the organizer's central Files view already has the slot's
 * three coordinates from the row it is showing, so it supplies them directly
 * — both paths land on the same `addFileCommentIn` writer.
 */
export const organizerCommentInputSchema = z.object({
  // Optional during the rollout so an organizer with the previous client
  // bundle already open can still send. New clients always provide this key
  // and get replay-safe recovery; the writer generates one for legacy calls.
  id: fileCommentIdSchema.optional(),
  fileRequestId: fileRequestIdSchema,
  contactId: contactIdSchema,
  submissionId: submissionIdSchema.nullable().default(null),
  body: z.string().trim().min(1).max(5_000),
});
export type OrganizerCommentInput = z.infer<typeof organizerCommentInputSchema>;

export function addOrganizerComment(eventId: EventId, actorUserId: UserId, input: OrganizerCommentInput): Promise<FileCommentDTO> {
  return addFileCommentIn(
    db, eventId, input.fileRequestId, input.contactId, input.submissionId,
    { role: "organizer", userId: actorUserId }, input.body, input.id,
  );
}

/** The central Files view's bulk bar: remind every selected, still-open row. */
export const bulkRemindInputSchema = z.object({
  targets: z.array(bulkReminderTargetSchema).min(1).max(BULK_REMINDER_TARGET_LIMIT),
  // Optional while older open browser bundles roll forward. New clients
  // freeze this id with the exact target list before starting the POST.
  attemptId: z.uuid().optional(),
});
export type BulkRemindInput = z.infer<typeof bulkRemindInputSchema>;

export function bulkRemind(eventId: EventId, input: BulkRemindInput): Promise<BulkReminderResult> {
  return sendRemindersNow(eventId, input.targets, input.attemptId);
}
