import type {
  FieldId,
  FieldType,
  FormContext,
  FormField,
  FormId,
  FormStatus,
  MapsToTarget,
  ReviewVisibility,
  SectionId,
  SubmissionKind,
  TaskTarget,
  VisibilityRule,
} from "@/shared/contracts";
import type { FormAvailability } from "./lib/form-open";

export const BUILDER_STEPS = ["setup", "welcome", "abstract", "participant", "settings", "notifications"] as const;
export type BuilderStep = (typeof BUILDER_STEPS)[number];

/**
 * What each system mapping is called on screen. `MAPS_TO_TARGETS` are storage
 * paths (`contact.headshot_file_id`); organizers choose destinations by the
 * names the rest of the product already uses. `Record<MapsToTarget, string>`
 * makes a new target without a name a type error.
 */
export const MAPS_TO_LABELS: Record<MapsToTarget, string> = {
  "submission.title": "Session title",
  "submission.description_html": "Abstract",
  "submission.track_id": "Track",
  "submission.format_id": "Session format",
  "submission.level": "Level",
  "submission.language": "Language",
  "contact.first_name": "First name",
  "contact.last_name": "Last name",
  "contact.email": "Email",
  "contact.bio_html": "Biography",
  "contact.company": "Company",
  "contact.job_title": "Job title",
  "contact.pronouns": "Pronouns",
  "contact.headshot_file_id": "Headshot",
  "contact.linkedin_url": "LinkedIn",
  "contact.twitter_url": "Twitter/X",
  "contact.website_url": "Website",
};

export function mapsToLabel(target: MapsToTarget): string {
  return MAPS_TO_LABELS[target];
}

export type BuilderEvent = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  // M14: the "Event max: N" fallback chip on the Submission capacity card.
  submissionCapPerUser: number;
};

export type BuilderField = {
  id: FieldId;
  sectionId: SectionId;
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  locked: boolean;
  maxChars: number | null;
  helpText: string;
  options: FormField["options"];
  visibility: VisibilityRule | null;
  mapsTo: MapsToTarget | null;
  // M50: what a blind reviewer may see of this question. `identity` is the
  // fail-closed default and the only value a locked contact field can hold.
  reviewVisibility: ReviewVisibility;
  sortOrder: number;
};

export type BuilderSection = {
  id: SectionId;
  key: string;
  title: string;
  pageHeading: string;
  descriptionHtml: string;
  sortOrder: number;
  fields: BuilderField[];
};

export type BuilderForm = {
  id: FormId;
  eventId: string;
  context: FormContext;
  // M12-GENERALIZE: only meaningful for context='portal' (M24's forms target
  // a contact or a submission's own fields); null for context='cfp'.
  targetType: TaskTarget | null;
  internalName: string;
  externalTitle: string;
  pageHeading: string;
  status: FormStatus;
  kind: SubmissionKind;
  collectParticipants: boolean;
  opensAt: string | null;
  closesAt: string | null;
  submissionLimit: number | null;
  showWelcome: boolean;
  welcomeHtml: string;
  successHtml: string;
  autoRedirectToPortal: boolean;
  participantRoles: Array<{ role: "speaker" | "co_speaker" | "moderator" | "panelist"; enabled: boolean }>;
  sendConfirmation: boolean;
  confirmationSubject: string;
  confirmationBodyHtml: string;
  currentVersion: number;
  updatedAt: string;
  hasNonDraftSubmissions: boolean;
  sections: BuilderSection[];
};

export type FormListRow = {
  id: FormId;
  internalName: string;
  externalTitle: string;
  status: FormStatus;
  availability: FormAvailability;
  kind: SubmissionKind;
  targetType: TaskTarget | null;
  collectParticipants: boolean;
  opensAt: string | null;
  closesAt: string | null;
  createdAt: string;
  submissionCount: number;
  draftCount: number;
  pendingCount: number;
  currentVersion: number;
};

type OptionalValues<T> = { [K in keyof T]?: T[K] | undefined };

export type FormPatch = OptionalValues<Pick<BuilderForm,
  | "internalName"
  | "externalTitle"
  | "pageHeading"
  | "status"
  | "kind"
  | "collectParticipants"
  | "opensAt"
  | "closesAt"
  | "submissionLimit"
  | "showWelcome"
  | "welcomeHtml"
  | "successHtml"
  | "autoRedirectToPortal"
  | "participantRoles"
  | "sendConfirmation"
  | "confirmationSubject"
  | "confirmationBodyHtml"
>>;

export type SectionPatch = OptionalValues<Pick<BuilderSection, "title" | "pageHeading" | "descriptionHtml">>;

export type FieldPatch = OptionalValues<Pick<BuilderField,
  "label" | "key" | "fieldType" | "required" | "maxChars" | "helpText" | "visibility" | "mapsTo" | "reviewVisibility"
>> & { optionLabels?: string[] | undefined };
