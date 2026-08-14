import { z } from "zod";
import { contactIdSchema, eventIdSchema, sendReminderNowInputSchema, type ContactId, type EventId } from "@/shared/contracts";
import { openAssignmentRowSchema, type OpenAssignmentRow } from "./schemas";

const RECOVERY_VERSION = 1;
const exactReminderInputSchema = sendReminderNowInputSchema.extend({ attemptId: z.uuid() });
const targetedReminderRecoverySchema = z.object({
  version: z.literal(RECOVERY_VERSION),
  eventId: eventIdSchema,
  contactId: contactIdSchema,
  assignment: openAssignmentRowSchema,
  input: exactReminderInputSchema,
});

export type TargetedReminderRecovery = {
  version: typeof RECOVERY_VERSION;
  eventId: EventId;
  contactId: ContactId;
  assignment: OpenAssignmentRow;
  input: z.infer<typeof exactReminderInputSchema>;
};

export function targetedReminderRecoveryKey(eventId: EventId, contactId: ContactId): string {
  return `openboard:targeted-reminder:${eventId}:${contactId}`;
}

export function loadTargetedReminderRecovery(
  storage: Pick<Storage, "getItem">,
  eventId: EventId,
  contactId: ContactId,
): TargetedReminderRecovery | null {
  try {
    const raw = storage.getItem(targetedReminderRecoveryKey(eventId, contactId));
    if (!raw) return null;
    const parsed = targetedReminderRecoverySchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.eventId !== eventId || parsed.data.contactId !== contactId) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Persist synchronously before the POST; a failed write means no send starts. */
export function persistTargetedReminderRecovery(
  storage: Pick<Storage, "getItem" | "setItem">,
  recovery: TargetedReminderRecovery,
): boolean {
  try {
    const existing = loadTargetedReminderRecovery(storage, recovery.eventId, recovery.contactId);
    if (existing && existing.input.attemptId !== recovery.input.attemptId) return false;
    storage.setItem(
      targetedReminderRecoveryKey(recovery.eventId, recovery.contactId),
      JSON.stringify(targetedReminderRecoverySchema.parse(recovery)),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearTargetedReminderRecovery(
  storage: Pick<Storage, "getItem" | "removeItem">,
  eventId: EventId,
  contactId: ContactId,
  attemptId: string,
): void {
  try {
    const current = loadTargetedReminderRecovery(storage, eventId, contactId);
    if (current?.input.attemptId !== attemptId) return;
    storage.removeItem(targetedReminderRecoveryKey(eventId, contactId));
  } catch {
    // A stale record can only replay the same unique outbox key. Ignore an
    // unavailable storage backend instead of turning a confirmed send into an
    // organizer-visible failure.
  }
}
