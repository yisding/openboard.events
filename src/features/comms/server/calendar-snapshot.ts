import { z } from "zod";
import {
  contactIdSchema,
  eventIdSchema,
  sessionIdSchema,
  type CalendarEventSnapshotStored,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

const storedDateSchema = z.union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => value instanceof Date ? value : new Date(value));

/**
 * The immutable event details from the most recently prepared REQUEST.
 *
 * A cancellation must describe the event the recipient actually received,
 * not whatever is left on the mutable session after it was unpublished,
 * unscheduled, reassigned, or deleted. `calendar_invites.event_snapshot`
 * stores this shape alongside the stable UID and organizer.
 */
export const calendarEventSnapshotSchema = z.object({
  version: z.literal(1),
  eventId: eventIdSchema,
  sessionId: sessionIdSchema,
  contactId: contactIdSchema,
  title: z.string(),
  descriptionHtml: z.string().nullable(),
  startsAt: storedDateSchema,
  endsAt: storedDateSchema,
  room: z.string().nullable(),
  track: z.string().nullable(),
  eventName: z.string(),
  eventSlug: z.string(),
  eventLocation: z.string().nullable(),
  eventTimezone: z.string().min(1),
  attendeeEmail: z.email(),
  attendeeFirstName: z.string(),
  attendeeLastName: z.string(),
});

export type CalendarEventSnapshot = z.infer<typeof calendarEventSnapshotSchema>;

/**
 * A self-contained CANCEL job. This survives the session FK becoming NULL and
 * the calendar-invite row cascading away during a hard delete.
 */
export const calendarCancellationSnapshotSchema = calendarEventSnapshotSchema.extend({
  uid: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  organizerEmail: z.email(),
  cancelledAt: storedDateSchema,
});

export type CalendarCancellationSnapshot = z.infer<typeof calendarCancellationSnapshotSchema>;

export function serializeCalendarEventSnapshot(snapshot: CalendarEventSnapshot): CalendarEventSnapshotStored {
  return {
    ...snapshot,
    startsAt: snapshot.startsAt.toISOString(),
    endsAt: snapshot.endsAt.toISOString(),
  };
}

export function assertSnapshotIdentity(
  snapshot: CalendarEventSnapshot,
  row: { eventId: string; contactId: string; sessionId: string | null },
): void {
  if (snapshot.eventId !== row.eventId
      || snapshot.contactId !== row.contactId
      || (row.sessionId !== null && snapshot.sessionId !== row.sessionId)) {
    throw new AppError("VALIDATION", "calendar snapshot does not match its outbox row");
  }
}

export function parseCalendarEventSnapshot(value: unknown): CalendarEventSnapshot {
  const parsed = calendarEventSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      "stored calendar event snapshot is invalid",
      z.treeifyError(parsed.error),
    );
  }
  return parsed.data;
}

export function parseCalendarCancellationSnapshot(value: unknown): CalendarCancellationSnapshot {
  const parsed = calendarCancellationSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      "stored calendar cancellation snapshot is invalid",
      z.treeifyError(parsed.error),
    );
  }
  return parsed.data;
}
