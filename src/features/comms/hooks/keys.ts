import type { CommLogId, ContactId, EventId } from "@/shared/contracts";
import { qk } from "@/shared/lib/query-keys";
import type { CommLogFilters } from "../server/queries";

/** Exact Communications cache ownership shared by reads and mutations. */
export const commsKeys = {
  all: (eventId: EventId) => qk("comms", eventId),
  templates: (eventId: EventId) => qk("comms", eventId, "templates"),
  reminderRules: (eventId: EventId) => qk("comms", eventId, "reminder-rules"),
  logs: (eventId: EventId) => qk("comms", eventId, "log"),
  log: (eventId: EventId, filters: CommLogFilters) => qk("comms", eventId, "log", filters),
  logDetail: (eventId: EventId, logId: CommLogId | null) =>
    qk("comms", eventId, "log-detail", logId ?? "-"),
  suppressions: (eventId: EventId) => qk("comms", eventId, "suppressions"),
  deliverability: (eventId: EventId) => qk("comms", eventId, "deliverability"),
  openAssignments: (eventId: EventId, contactId: ContactId | null) =>
    qk("comms", eventId, "open-assignments", contactId ?? "-"),
} as const;
