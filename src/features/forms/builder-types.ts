import type {
  FieldId,
  FieldType,
  FormField,
  FormId,
  FormStatus,
  MapsToTarget,
  SectionId,
  SubmissionKind,
  VisibilityRule,
} from "@/shared/contracts";

export const BUILDER_STEPS = ["setup", "welcome", "abstract", "participant", "settings", "notifications"] as const;
export type BuilderStep = (typeof BUILDER_STEPS)[number];

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
  context: "cfp" | "portal";
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
  kind: SubmissionKind;
  collectParticipants: boolean;
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
  "label" | "key" | "fieldType" | "required" | "maxChars" | "helpText" | "visibility" | "mapsTo"
>> & { optionLabels?: string[] | undefined };
