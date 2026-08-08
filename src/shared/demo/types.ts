import type { Answers, FieldType, SubmissionStatus } from "@/shared/contracts";

export type EventRecord = {
  id: string; slug: string; name: string; shortName: string; timezone: string; city: string; venue: string;
  startsAt: string; endsAt: string; accent: string; logoText: string; status: "draft" | "live" | "complete";
};

export type FormFieldRecord = {
  id: string; key: string; label: string; type: FieldType; required: boolean; locked: boolean; helpText: string;
  placeholder: string; maxChars: number | null; options: string[]; visibility?: { fieldId: string; operator: "eq" | "neq" | "answered" | "empty"; value?: string } | null;
};
export type FormSectionRecord = { id: string; title: string; description: string; fields: FormFieldRecord[] };
export type FormRecord = {
  id: string; eventId: string; slug: string; name: string; status: "draft" | "open" | "closed"; version: number;
  opensAt: string; closesAt: string; submissionLimit: number; maxPerSpeaker: number; submissions: number;
  welcomeTitle: string; welcomeBody: string; successTitle: string; successBody: string; sections: FormSectionRecord[];
};

export type SpeakerRecord = {
  id: string; eventId: string; firstName: string; lastName: string; email: string; company: string; title: string;
  bio: string; location: string; website: string; linkedin: string; avatar: string; avatarColor: string;
  confirmation: "unconfirmed" | "confirmed" | "declined"; profileCompletion: number; tags: string[];
};

export type SubmissionRecord = {
  id: string; code: string; eventId: string; formId: string; title: string; type: string; status: SubmissionStatus;
  speakerIds: string[]; track: string; format: string; tags: string[]; submittedAt: string; updatedAt: string;
  abstract: string; audience: string; takeaways: string; answers: Answers; score: number | null; reviewCount: number;
};

export type SessionRecord = {
  id: string; eventId: string; submissionId: string | null; title: string; speakerIds: string[]; track: string; room: string;
  startsAt: string | null; endsAt: string | null; status: "draft" | "published"; description: string;
};

export type TaskRecord = {
  id: string; eventId: string; title: string; description: string; mode: "manual" | "form" | "file_request";
  target: "contact" | "submission"; dueAt: string; assigned: number; completed: number; required: boolean;
};
export type TaskCompletion = { taskId: string; speakerId: string; completedAt: string; fileName?: string; payload?: Record<string, string>; submissionId?: string };

export type CommunicationRecord = {
  id: string; eventId: string; recipient: string; subject: string; template: string; status: "queued" | "sent" | "failed";
  sentAt: string; preview: string;
};

export type ReviewRecord = { id: string; submissionId: string; reviewer: string; score: number; note: string; createdAt: string };
export type PlanRecord = { id: string; eventId: string; name: string; scale: string; trackScope: string; status: "open" | "closed" };
export type ResourceRecord = { id: string; eventId: string; title: string; slug: string; summary: string; body: string; published: boolean };

export type DemoState = {
  events: EventRecord[]; forms: FormRecord[]; speakers: SpeakerRecord[]; submissions: SubmissionRecord[]; sessions: SessionRecord[];
  tasks: TaskRecord[]; completions: TaskCompletion[]; communications: CommunicationRecord[]; reviews: ReviewRecord[]; resources: ResourceRecord[];
  plans: PlanRecord[];
};

export type DemoAction =
  | { type: "RESET" }
  | { type: "HYDRATE"; state: DemoState }
  | { type: "ADD_FORM"; form: FormRecord }
  | { type: "UPDATE_FORM"; formId: string; patch: Partial<FormRecord> }
  | { type: "ADD_FIELD"; formId: string; sectionId: string; field: FormFieldRecord }
  | { type: "UPDATE_FIELD"; formId: string; sectionId: string; fieldId: string; patch: Partial<FormFieldRecord> }
  | { type: "DELETE_FIELD"; formId: string; sectionId: string; fieldId: string }
  | { type: "ADD_SUBMISSION"; submission: SubmissionRecord }
  | { type: "UPDATE_SUBMISSION"; submissionId: string; patch: Partial<SubmissionRecord> }
  | { type: "ADD_REVIEW"; review: ReviewRecord }
  | { type: "UPSERT_REVIEW"; review: ReviewRecord }
  | { type: "ADD_PLAN"; plan: PlanRecord }
  | { type: "ADD_SPEAKER"; speaker: SpeakerRecord }
  | { type: "UPDATE_SPEAKER"; speakerId: string; patch: Partial<SpeakerRecord> }
  | { type: "ADD_TASK"; task: TaskRecord }
  | { type: "UPDATE_TASK"; taskId: string; patch: Partial<TaskRecord> }
  | { type: "COMPLETE_TASK"; completion: TaskCompletion }
  | { type: "ADD_SESSION"; session: SessionRecord }
  | { type: "UPDATE_SESSION"; sessionId: string; patch: Partial<SessionRecord> }
  | { type: "ADD_COMMUNICATION"; communication: CommunicationRecord }
  | { type: "UPDATE_EVENT"; eventId: string; patch: Partial<EventRecord> }
  | { type: "ADD_RESOURCE"; resource: ResourceRecord }
  | { type: "UPDATE_RESOURCE"; resourceId: string; patch: Partial<ResourceRecord> };
