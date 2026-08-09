import type { CompletionVia, SubmissionStatus } from "@/shared/contracts";

export type AcceptedSpeakerRow = { eventId: string; contactId: string; updatedAt: Date };
export type TaskAssignmentRow = { taskId: string; eventId: string; contactId: string; submissionId: string | null; dueAt: Date | null; completed: boolean; completedAt: Date | null; completedVia: CompletionVia | null; overdue: boolean; updatedAt: Date };
export type SpeakerOutstandingRow = { eventId: string; contactId: string; openCount: number; overdueCount: number; doneCount: number; updatedAt: Date };
export type MissingAssetsRow = { eventId: string; contactId: string; missingBio: boolean; missingHeadshot: boolean; updatedAt: Date };
export type SubmissionStatusCountRow = { eventId: string; status: SubmissionStatus; n: number; updatedAt: Date };
export type SubmissionRatingRow = { eventId: string; submissionId: string; planId: string; rating: string; nScores: number; updatedAt: Date };
export type PublishedSessionRow = { id: string; eventId: string; title: string; slug: string; descriptionHtml: string | null; startsAt: Date; endsAt: Date; trackId: string | null; trackName: string | null; trackColor: string | null; roomId: string | null; roomName: string | null; formatId: string | null; formatName: string | null; updatedAt: Date };
export type PublishedSpeakerRow = { eventId: string; contactId: string; firstName: string; lastName: string; jobTitle: string | null; company: string | null; bioHtml: string | null; headshotFileId: string | null; linkedinUrl: string | null; twitterUrl: string | null; websiteUrl: string | null; updatedAt: Date };
