import { eventIdSchema } from "@/shared/contracts";
import { DEMO_EVENT_ID } from "@/shared/demo/seed";
import type { SpeakerRecord } from "@/shared/demo/types";
import type { DashboardOverview } from "./index";

const EVENT_ID = eventIdSchema.parse("a0000000-0000-4000-8000-000000000001");

export const FIXTURE_OVERVIEW: DashboardOverview = {
  event: {
    id: EVENT_ID,
    slug: "ai-engineer",
    name: "AI Engineer World's Fair",
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
    { code: "unscheduled_accepted", count: 3, href: `/events/${EVENT_ID}/agenda?view=day` },
    { code: "awaiting_decision", count: 7, href: `/events/${EVENT_ID}/abstracts?status=pending` },
    { code: "missing_assets", count: 2, href: `/events/${EVENT_ID}/speakers?missing=either` },
  ],
  forms: [{
    formId: "a0000000-0000-4000-8000-000000000003",
    name: "Technical talks",
    status: "open",
    closesAt: "2026-08-31T07:00:00.000Z",
    submitted: 23,
    drafts: 2,
  }],
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

/** Records behind local dashboard contact links; ids intentionally match the overview rows. */
export const FIXTURE_DASHBOARD_SPEAKERS: SpeakerRecord[] = [
  {
    id: "a0000000-0000-4000-8000-000000000004",
    eventId: DEMO_EVENT_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    title: "Programmer",
    bio: "Pioneer of general-purpose computing.",
    location: "London",
    website: "",
    linkedin: "",
    avatar: "AL",
    avatarColor: "#007454",
    hasHeadshot: true,
    confirmation: "confirmed",
    profileCompletion: 100,
    tags: [],
  },
  {
    id: "a0000000-0000-4000-8000-000000000005",
    eventId: DEMO_EVENT_ID,
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    company: "US Navy",
    title: "Computer scientist",
    bio: "Built compilers and made computing more accessible.",
    location: "New York, NY",
    website: "",
    linkedin: "",
    avatar: "GH",
    avatarColor: "#2a8471",
    hasHeadshot: true,
    confirmation: "confirmed",
    profileCompletion: 100,
    tags: [],
  },
];

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
  recentSubmissions: [],
};
