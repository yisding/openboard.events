import { eventIdSchema } from "@/shared/contracts";
import type { DashboardOverview } from "../index";

/**
 * Test-only `DashboardOverview` values.
 *
 * These used to live in `features/dashboard/fixtures.ts` and doubled as the
 * browser demo's dashboard data. The demo is gone, so they are what they always
 * really were: two hand-written overviews — one populated, one empty — that let
 * the phase/tab logic and the dashboard panels be exercised without a database.
 */

const EVENT_ID = eventIdSchema.parse("a0000000-0000-4000-8000-000000000001");

export const FIXTURE_OVERVIEW: DashboardOverview = {
  event: {
    id: EVENT_ID,
    slug: "ai-engineer",
    name: "AI Engineer World’s Fair",
    timezone: "America/Los_Angeles",
    startsAt: "2026-09-15T16:00:00.000Z",
    daysToEvent: 38,
  },
  kpis: { submissions: 25, acceptedSpeakers: 12, scheduledSessions: 9, unscheduledAccepted: 3 },
  statusCounts: {
    draft: 2,
    pending: 7,
    accept_queue: 1,
    decline_queue: 1,
    accepted: 12,
    declined: 3,
    withdrawn: 1,
  },
  speakerTracking: {
    acceptedSpeakers: 12,
    outstandingTasks: 3,
    overdueTasks: 1,
    topByOutstanding: [
      { contactId: "a0000000-0000-4000-8000-000000000004", name: "Ada Lovelace", openCount: 2, overdueCount: 1 },
      { contactId: "a0000000-0000-4000-8000-000000000005", name: "Grace Hopper", openCount: 1, overdueCount: 0 },
    ],
    overdue: [{
      contactId: "a0000000-0000-4000-8000-000000000004",
      name: "Ada Lovelace",
      taskId: "a0000000-0000-4000-8000-000000000009",
      taskName: "Complete profile",
      submissionCode: "SESS-101",
      dueAt: "2026-08-01T19:00:00.000Z",
    }],
    confirmationMix: { confirmed: 8, unconfirmed: 3, declined: 1 },
    missingAssets: { speakers: 2, bios: 2, headshots: 1 },
  },
  attention: [
    // Rank 0 with the smallest count of the four: the row that only leads if
    // the queue honours rank before count.
    { rank: 0, code: "hidden_published", count: 1, href: `/events/${EVENT_ID}/agenda?view=list` },
    { rank: 1, code: "unscheduled_accepted", count: 3, href: `/events/${EVENT_ID}/agenda?view=day` },
    { rank: 2, code: "awaiting_decision", count: 7, href: `/events/${EVENT_ID}/abstracts?status=pending` },
    { rank: 3, code: "missing_assets", count: 2, href: `/events/${EVENT_ID}/speakers?missing=either` },
  ],
  forms: [{
    formId: "a0000000-0000-4000-8000-000000000003",
    name: "Technical talks",
    status: "open",
    availability: "live",
    opensAt: null,
    closesAt: "2026-08-31T07:00:00.000Z",
    submitted: 23,
    drafts: 2,
  }],
  latestCfpSubmission: {
    id: "a0000000-0000-4000-8000-000000000007",
    title: "Fast inference",
  },
  recentSubmissions: [{
    id: "a0000000-0000-4000-8000-000000000007",
    code: "SESS-102",
    title: "Fast inference",
    status: "pending",
    source: "Technical talks",
    speakers: ["Ada Lovelace"],
    tags: ["AI safety"],
    submittedAt: "2026-08-08T01:00:00.000Z",
  }],
};

export const EMPTY_FIXTURE_OVERVIEW: DashboardOverview = {
  event: {
    id: eventIdSchema.parse("a0000000-0000-4000-8000-000000000002"),
    slug: "empty-event",
    name: "Empty event",
    timezone: "America/New_York",
    startsAt: "2026-10-01T13:00:00.000Z",
    daysToEvent: 54,
  },
  kpis: { submissions: 0, acceptedSpeakers: 0, scheduledSessions: 0, unscheduledAccepted: 0 },
  statusCounts: { draft: 0, pending: 0, accept_queue: 0, decline_queue: 0, accepted: 0, declined: 0, withdrawn: 0 },
  speakerTracking: {
    acceptedSpeakers: 0,
    outstandingTasks: 0,
    overdueTasks: 0,
    topByOutstanding: [],
    overdue: [],
    confirmationMix: { confirmed: 0, unconfirmed: 0, declined: 0 },
    missingAssets: { speakers: 0, bios: 0, headshots: 0 },
  },
  attention: [],
  forms: [],
  latestCfpSubmission: null,
  recentSubmissions: [],
};
