import { z } from "zod";
import { db } from "@/db/client";
import { formAvailability } from "@/features/forms/lib/form-open";
import {
  SUBMISSION_STATUSES,
  eventIdSchema,
  submissionStatusSchema,
  type EventId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { daysToEvent } from "@/shared/lib/time";
import type { DashboardOverview } from "../index";
import { queryDashboardOverview, type DashboardQueryDb } from "./queries";

/**
 * Dashboard counting laws:
 * - Submissions excludes draft; drafts remain visible in status/form counts.
 * - Accepted speakers is count(accepted_speakers_v), never a stored contact flag.
 * - Outstanding and overdue tasks come directly from task_assignments_v.
 * - Task fan-out is consumed from the view: submission tasks target one primary
 *   participant; contact tasks target every member of accepted_speakers_v.
 * - Missing-assets `speakers` counts people while `bios` and `headshots` count
 *   missing asset instances.
 */

const countSchema = z.coerce.number().int().nonnegative();
const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO datetime");
const rawFormSchema = z.object({
  formId: z.uuid(),
  name: z.string(),
  status: z.enum(["draft", "open", "closed"]),
  opensAt: isoDateTimeSchema.nullable(),
  closesAt: isoDateTimeSchema.nullable(),
  submitted: countSchema,
  drafts: countSchema,
});
const rawOverviewSchema = z.object({
  event: z.object({
    id: eventIdSchema,
    slug: z.string().min(1),
    name: z.string(),
    timezone: z.string(),
    startsAt: isoDateTimeSchema,
  }),
  kpis: z.object({
    submissions: countSchema,
    acceptedSpeakers: countSchema,
    scheduledSessions: countSchema,
    unscheduledAccepted: countSchema,
  }),
  statusCounts: z.record(z.string(), countSchema),
  speakerTracking: z.object({
    acceptedSpeakers: countSchema,
    outstandingTasks: countSchema,
    overdueTasks: countSchema,
    topByOutstanding: z.array(z.object({
      contactId: z.uuid(),
      name: z.string(),
      openCount: countSchema,
      overdueCount: countSchema,
    })).max(8),
    overdue: z.array(z.object({
      contactId: z.uuid(),
      name: z.string(),
      taskId: z.uuid(),
      taskName: z.string(),
      submissionCode: z.string().nullable(),
      dueAt: isoDateTimeSchema,
    })).max(10),
    confirmationMix: z.object({ confirmed: countSchema, unconfirmed: countSchema, declined: countSchema }),
    missingAssets: z.object({ speakers: countSchema, bios: countSchema, headshots: countSchema }),
  }),
  attention: z.array(z.object({
    code: z.enum(["unscheduled_accepted", "awaiting_decision", "missing_assets"]),
    count: countSchema,
    href: z.string().startsWith("/events/"),
  })),
  forms: z.array(rawFormSchema),
  latestCfpSubmission: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  recentSubmissions: z.array(z.object({
    id: z.uuid(),
    code: z.string(),
    title: z.string(),
    status: submissionStatusSchema,
    source: z.string(),
    speakers: z.array(z.string()),
    tags: z.array(z.string()),
    submittedAt: isoDateTimeSchema.nullable(),
  })).max(10),
});

export const dashboardOverviewSchema: z.ZodType<DashboardOverview> = rawOverviewSchema.extend({
  event: rawOverviewSchema.shape.event.extend({ daysToEvent: z.number().int() }),
  statusCounts: z.record(submissionStatusSchema, countSchema),
  forms: z.array(rawFormSchema.extend({
    availability: z.enum(["draft", "live", "scheduled", "ended", "closed"]),
  })),
});

export async function getOverviewIn(
  dbOrTx: DashboardQueryDb,
  eventId: EventId,
  now = new Date(),
): Promise<DashboardOverview> {
  const raw = await queryDashboardOverview(dbOrTx, eventId);
  if (!raw) throw new AppError("NOT_FOUND", "Event not found");
  const parsed = rawOverviewSchema.parse(raw);
  const statusCounts = Object.fromEntries(
    SUBMISSION_STATUSES.map((status) => [status, parsed.statusCounts[status] ?? 0]),
  ) as DashboardOverview["statusCounts"];
  const nowIso = now.toISOString();
  return dashboardOverviewSchema.parse({
    ...parsed,
    forms: parsed.forms.map((form) => ({ ...form, availability: formAvailability(form, nowIso) })),
    event: {
      ...parsed.event,
      daysToEvent: daysToEvent(now, new Date(parsed.event.startsAt), parsed.event.timezone),
    },
    statusCounts,
  });
}

export function getOverview(eventId: EventId): Promise<DashboardOverview> {
  return getOverviewIn(db, eventId);
}
