import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { events, formFields, forms, formSections, submissions } from "@/db/schema";
import {
  formIdSchema,
  formOptionSchema,
  mapsToTargetSchema,
  visibilityRuleSchema,
  type EventId,
  type FormId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { BuilderEvent, BuilderField, BuilderForm, BuilderSection, FormListRow } from "../builder-types";
import { decideOpenState } from "./public-form";

const participantRolesSchema = z.array(z.object({
  role: z.enum(["speaker", "co_speaker", "moderator", "panelist"]),
  enabled: z.boolean(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
}));

export async function getBuilderEventIn(dbOrTx: DbOrTx, eventId: EventId): Promise<BuilderEvent> {
  const [event] = await dbOrTx.select({
    id: events.id,
    name: events.name,
    slug: events.slug,
    timezone: events.timezone,
    // M14: the Submission capacity card's "Event max: N" fallback chip.
    submissionCapPerUser: events.submissionCapPerUser,
  })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");
  return event;
}

export function getBuilderEvent(eventId: EventId): Promise<BuilderEvent> {
  return getBuilderEventIn(db, eventId);
}

export async function listFormsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<FormListRow[]> {
  const rows = await dbOrTx.select({
    id: forms.id,
    internalName: forms.internalName,
    externalTitle: forms.externalTitle,
    status: forms.status,
    kind: forms.kind,
    collectParticipants: forms.collectParticipants,
    opensAt: forms.opensAt,
    closesAt: forms.closesAt,
    createdAt: forms.createdAt,
    submissionCount: sql<number>`count(${submissions.id}) filter (where ${submissions.status} <> 'draft')::int`,
    draftCount: sql<number>`count(${submissions.id}) filter (where ${submissions.status} = 'draft')::int`,
    pendingCount: sql<number>`count(${submissions.id}) filter (where ${submissions.status} = 'pending')::int`,
    currentVersion: forms.currentVersion,
  })
    .from(forms)
    .leftJoin(submissions, and(eq(submissions.eventId, forms.eventId), eq(submissions.formId, forms.id)))
    .where(and(eq(forms.eventId, eventId), eq(forms.context, "cfp")))
    .groupBy(forms.id)
    .orderBy(asc(forms.createdAt), asc(forms.id));

  const now = new Date();
  return rows.map((row) => {
    const { opensAt, ...visible } = row;
    const effectiveStatus = row.status === "open" && !decideOpenState({ status: row.status, opensAt, closesAt: row.closesAt }, now).open
      ? "closed"
      : row.status;
    return {
      ...visible,
      status: effectiveStatus,
      id: formIdSchema.parse(row.id),
      closesAt: row.closesAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      submissionCount: Number(row.submissionCount),
      draftCount: Number(row.draftCount),
      pendingCount: Number(row.pendingCount),
    };
  });
}

export function listForms(eventId: EventId): Promise<FormListRow[]> {
  return listFormsIn(db, eventId);
}

export async function hasNonDraftSubmissionsIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<boolean> {
  const [row] = await dbOrTx.select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.eventId, eventId), eq(submissions.formId, formId), ne(submissions.status, "draft")))
    .limit(1);
  return Boolean(row);
}

export async function getFormForBuilderIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<BuilderForm> {
  const [form] = await dbOrTx.select().from(forms)
    .where(and(eq(forms.eventId, eventId), eq(forms.id, formId)))
    .limit(1);
  if (!form || form.context !== "cfp") throw new AppError("NOT_FOUND", "Form not found");

  const [sectionRows, fieldRows, hasNonDraftSubmissions] = await Promise.all([
    dbOrTx.select().from(formSections)
      .where(and(eq(formSections.eventId, eventId), eq(formSections.formId, formId)))
      .orderBy(asc(formSections.sortOrder), asc(formSections.id)),
    dbOrTx.select().from(formFields)
      .where(and(eq(formFields.eventId, eventId), eq(formFields.formId, formId), sql`${formFields.deletedAt} IS NULL`))
      .orderBy(asc(formFields.sortOrder), asc(formFields.id)),
    hasNonDraftSubmissionsIn(dbOrTx, eventId, formId),
  ]);

  const fields = fieldRows.map((field): BuilderField => ({
    id: field.id as BuilderField["id"],
    sectionId: field.sectionId as BuilderField["sectionId"],
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    locked: field.locked,
    maxChars: field.maxChars,
    helpText: field.helpText ?? "",
    options: z.array(formOptionSchema).parse(field.options ?? []),
    visibility: field.visibility === null ? null : visibilityRuleSchema.parse(field.visibility),
    mapsTo: field.mapsTo === null ? null : mapsToTargetSchema.parse(field.mapsTo),
    sortOrder: field.sortOrder,
  }));
  const sections = sectionRows.map((section): BuilderSection => ({
    id: section.id as BuilderSection["id"],
    key: section.key,
    title: section.title,
    pageHeading: section.pageHeading,
    descriptionHtml: section.descriptionHtml ?? "",
    sortOrder: section.sortOrder,
    fields: fields.filter((field) => field.sectionId === section.id),
  }));
  const participantRoles = participantRolesSchema.parse(form.participantRoles).map(({ role, enabled }) => ({ role, enabled }));

  return {
    id: formIdSchema.parse(form.id),
    eventId: form.eventId,
    context: form.context,
    internalName: form.internalName,
    externalTitle: form.externalTitle,
    pageHeading: form.pageHeading,
    status: form.status,
    kind: form.kind,
    collectParticipants: form.collectParticipants,
    opensAt: form.opensAt?.toISOString() ?? null,
    closesAt: form.closesAt?.toISOString() ?? null,
    submissionLimit: form.submissionLimit,
    showWelcome: form.showWelcome,
    welcomeHtml: form.welcomeHtml ?? "",
    successHtml: form.successHtml ?? "",
    autoRedirectToPortal: form.autoRedirectToPortal,
    participantRoles,
    sendConfirmation: form.sendConfirmation,
    confirmationSubject: form.confirmationSubject ?? "",
    confirmationBodyHtml: form.confirmationBodyHtml ?? "",
    currentVersion: form.currentVersion,
    updatedAt: form.updatedAt.toISOString(),
    hasNonDraftSubmissions,
    sections,
  };
}

export function getFormForBuilder(eventId: EventId, formId: FormId): Promise<BuilderForm> {
  return getFormForBuilderIn(db, eventId, formId);
}
