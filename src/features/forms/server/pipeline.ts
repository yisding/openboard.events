import { z } from "zod";
import {
  LIMITS,
  answerValueSchema,
  cleanAnswersSchema,
  plainTextLength,
  type AnswerValue,
  type Answers,
  type CleanAnswers,
  type FormField,
  type FormSnapshot,
} from "@/shared/contracts";
import { evaluateVisibility, stripHiddenAnswers } from "@/shared/lib/conditions";
import { sanitize } from "@/shared/lib/sanitize";

/**
 * The only way raw answers become persistable. Five steps — parse, visibility,
 * strip, validate, brand — and no database, no session and no wizard
 * assumptions, so M41's edit path and M25's portal responses run the same code
 * as the public CFP.
 *
 * The order matters: a field is validated **after** it is stripped, so a
 * required field the speaker can no longer see is not a required field. The
 * alternative traps someone behind a validation error for a question the form
 * stopped asking them.
 */
export type RawAnswers = Readonly<Record<string, unknown>>;

export type PipelineResult =
  | { ok: true; clean: CleanAnswers; discarded: string[] }
  | { ok: false; code: "VALIDATION"; fieldErrors: Record<string, string> };

function allFields(snapshot: FormSnapshot): FormField[] {
  return snapshot.sections.flatMap((section) => section.fields);
}

function isEmpty(field: FormField, value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (value.t === "s") return field.type === "richtext" ? plainTextLength(value.v) === 0 : value.v.trim().length === 0;
  if (value.t === "opt") return value.v === "";
  if (value.t === "opts") return value.v.length === 0;
  return false;
}

/** Length is counted on text, not on markup, so `<b>` cannot eat a speaker's budget. */
function tooLong(field: FormField, value: AnswerValue): string | null {
  const max = field.maxChars ?? (field.type === "richtext" ? LIMITS.RICHTEXT : LIMITS.SHORT_TEXT);
  if (value.t !== "s") return null;
  const used = field.type === "richtext" ? plainTextLength(value.v) : value.v.length;
  return used > max ? `Keep this under ${max} characters` : null;
}

function invalidOption(field: FormField, value: AnswerValue): string | null {
  if (field.options.length === 0) return null;
  const allowed = new Set(field.options.map((option) => option.id));
  if (value.t === "opt" && !allowed.has(value.v)) return "Choose one of the offered options";
  if (value.t === "opts" && value.v.some((option) => !allowed.has(option))) return "Choose from the offered options";
  return null;
}

function expectedAnswerType(field: FormField): AnswerValue["t"] {
  switch (field.type) {
    case "text":
    case "textarea":
    case "richtext":
    case "email":
    case "phone":
    case "url": return "s";
    case "dropdown":
    case "radio": return "opt";
    case "multiselect":
    case "checkbox": return "opts";
    case "number": return "n";
    case "date": return "d";
    case "file": return "file";
  }
}

function invalidAnswerType(field: FormField, value: AnswerValue): string | null {
  return value.t === expectedAnswerType(field) ? null : "Use the expected answer type";
}

function invalidForField(field: FormField, value: AnswerValue): string | null {
  if (field.type === "email" && value.t === "s" && !z.email().safeParse(value.v).success) return "Enter a valid email address";
  if (field.type === "url" && value.t === "s" && !z.url().safeParse(value.v).success) return "Enter a valid URL";
  return invalidOption(field, value);
}

export function runSubmitPipeline(
  snapshot: FormSnapshot,
  raw: RawAnswers,
  opts: { participantId?: string | null; requireRequired: boolean },
): PipelineResult {
  const participantId = opts.participantId ?? null;

  // 1-3. Parse what the snapshot knows about, decide visibility from those same
  // answers, and drop everything hidden or unknown. A stale answer from a
  // branch the speaker backed out of never reaches the database.
  const fields = new Map(allFields(snapshot).map((field) => [field.id as string, field]));
  const parsed: Record<string, AnswerValue> = {};
  const parseErrors: Record<string, string> = {};
  const unknown: string[] = [];
  for (const [fieldId, value] of Object.entries(raw)) {
    const field = fields.get(fieldId);
    if (!field) {
      unknown.push(fieldId);
      continue;
    }
    if (value === undefined) continue;
    const answer = answerValueSchema.safeParse(value);
    if (!answer.success) {
      parseErrors[fieldId] = "Use the expected answer type";
      continue;
    }
    parsed[fieldId] = answer.data;
  }
  const visible = evaluateVisibility(snapshot, parsed as Answers);
  const { clean, discarded: hidden } = stripHiddenAnswers(snapshot, parsed as Answers, visible);
  const discarded = [...unknown, ...hidden, ...Object.keys(parseErrors).filter((fieldId) => !visible.has(fieldId as FormField["id"]))];

  // 4. Validate only what survived.
  const fieldErrors: Record<string, string> = {};
  for (const field of allFields(snapshot)) {
    if (!visible.has(field.id)) continue;
    const parseMessage = parseErrors[field.id];
    if (parseMessage) {
      fieldErrors[field.id] = parseMessage;
      continue;
    }
    const value = clean[field.id];
    // Empty is meaningful only after the discriminator agrees with the field.
    // Otherwise `{t:"opts",v:[]}` could masquerade as an empty text answer and
    // bypass validation on optional fields or draft saves.
    if (value) {
      const typeMessage = invalidAnswerType(field, value);
      if (typeMessage) {
        fieldErrors[field.id] = typeMessage;
        continue;
      }
    }
    if (isEmpty(field, value)) {
      if (opts.requireRequired && field.required) fieldErrors[field.id] = `${field.label} is required`;
      continue;
    }
    const message = invalidForField(field, value as AnswerValue) ?? tooLong(field, value as AnswerValue);
    if (message) fieldErrors[field.id] = message;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, code: "VALIDATION", fieldErrors };

  // 5. Brand. Rich text is sanitized here so no caller can persist raw HTML by
  // forgetting to; the sanitizer runs again on render regardless.
  const byId = new Map(allFields(snapshot).map((field) => [field.id, field]));
  const branded = Object.entries(clean).map(([fieldId, value]) => {
    const field = byId.get(fieldId as FormField["id"]);
    const answer = value as AnswerValue;
    return {
      fieldId,
      participantId,
      value: field?.type === "richtext" && answer.t === "s" ? { t: "s" as const, v: sanitize(answer.v) } : answer,
    };
  });

  return { ok: true, clean: cleanAnswersSchema.parse(branded), discarded };
}

/**
 * The typed columns a form fills in. `mapsTo` is the authoring-time promise that
 * a question feeds a real column; this is where that promise is kept, once,
 * rather than in each caller's own switch.
 */
export function deriveMappedFields(snapshot: FormSnapshot, clean: CleanAnswers): {
  submission: { title?: string; descriptionHtml?: string; trackId?: string | null; formatId?: string | null; level?: string | null };
  contact: Partial<Record<"firstName" | "lastName" | "email" | "bioHtml" | "company" | "jobTitle", string>>;
} {
  const byId = new Map(allFields(snapshot).map((field) => [field.id, field]));
  const submission: Record<string, string | null> = {};
  const contact: Record<string, string> = {};

  for (const answer of clean) {
    const field = byId.get(answer.fieldId);
    const target = field?.mapsTo;
    if (!field || !target) continue;
    const text = answer.value.t === "s" || answer.value.t === "opt" ? answer.value.v : null;
    if (text === null) continue;
    // A dropdown answer is an *option* id. The vocabulary id it stands for lives
    // on the option, which is the only place authoring recorded it — passing the
    // option id straight into track_id writes a broken foreign key.
    const chosen = answer.value.t === "opt" ? field.options.find((option) => option.id === answer.value.v) : undefined;
    switch (target) {
      case "submission.title": submission.title = text.slice(0, LIMITS.TITLE); break;
      case "submission.description_html": submission.descriptionHtml = text; break;
      case "submission.track_id": submission.trackId = chosen?.trackId ?? null; break;
      case "submission.format_id": submission.formatId = chosen?.formatId ?? null; break;
      // Option ids are immutable authoring identities, not semantic values for
      // the typed submission column. Store the organizer-facing level label.
      case "submission.level": submission.level = chosen?.label ?? text; break;
      case "contact.first_name": contact.firstName = text; break;
      case "contact.last_name": contact.lastName = text; break;
      case "contact.email": contact.email = text; break;
      case "contact.bio_html": contact.bioHtml = text; break;
      case "contact.company": contact.company = text; break;
      case "contact.job_title": contact.jobTitle = text; break;
      default: break; // The remaining targets are written by their own modules.
    }
  }
  return { submission, contact };
}
