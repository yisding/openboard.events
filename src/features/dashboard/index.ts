import type { EventId, SubmissionStatus } from "@/shared/contracts";

export type DashboardOverview = {
  event: { id: string; name: string; timezone: string; startsAt: string; daysToEvent: number };
  kpis: { submissions: number; acceptedSpeakers: number; scheduledSessions: number; unscheduledAccepted: number };
  statusCounts: Record<SubmissionStatus, number>;
  speakerTracking: {
    acceptedSpeakers: number;
    outstandingTasks: number;
    overdueTasks: number;
    topByOutstanding: { contactId: string; name: string; openCount: number; overdueCount: number }[];
    overdue: { contactId: string; name: string; taskId: string; taskName: string; submissionCode: string | null; dueAt: string }[];
    confirmationMix: { confirmed: number; unconfirmed: number; declined: number };
    missingAssets: { speakers: number; bios: number; headshots: number };
  };
  attention: { code: "unscheduled_accepted" | "awaiting_decision" | "missing_assets"; count: number; href: string }[];
  forms: { formId: string; name: string; status: "draft" | "open" | "closed"; closesAt: string | null; submitted: number; drafts: number }[];
  recentSubmissions: { id: string; code: string; title: string; status: SubmissionStatus; source: string; speakers: string[]; tags: string[]; submittedAt: string | null }[];
};

export { dashboardOverviewSchema, getOverview, getOverviewIn } from "./server/overview";

export type DashboardOverviewGetter = (eventId: EventId) => Promise<DashboardOverview>;
