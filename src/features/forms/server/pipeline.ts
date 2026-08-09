import {
  LIMITS,
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
export type RawAnswers = Readonly<Record<string, AnswerValue | undefined>>;

export type PipelineResult =
  | { ok: true; clean: CleanAnswers; discarded: string[] }
  | { ok: false; code: "VALIDATION"; fieldErrors: Record<string, string> };

function allFields(snapshot: FormSnapshot): FormField[] {
  return snapshot.sections.flatMap((section) => section.fields);
}

function isEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (value.t === "s") return value.v.trim().length === 0;
  if (value.t === "opts") return value.v.length === 0;
  return false;
}

/** Length is counted on text, not on markup, so `<b>` cannot eat a speaker's budget. */
function tooLong(field: FormField, value: AnswerValue): string | null {
  const max = field.maxChars ?? (field.type === "richtext" ? LIMITS.RICHTEXT : null);
  if (max === null || value.t !== "s") return null;
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

export function runSubmitPipeline(
  snapshot: FormSnapshot,
  raw: RawAnswers,
  opts: { participantId?: string | null; requireRequired: boolean },
): PipelineResult {
  const participantId = opts.participantId ?? null;

  // 1-3. Parse what the snapshot knows about, decide visibility from those same
  // answers, and drop everything hidden or unknown. A stale answer from a
  // branch the speaker backed out of never reaches the database.
  const parsed: Record<string, AnswerValue> = {};
  const fieldErrors: Record<string, string> = {};
  for (const [fieldId, value] of Object.entries(raw)) {
    if (value !== undefined) parsed[fieldId] = value;
  }
  const visible = evaluateVisibility(snapshot, parsed as Answers);
  const { clean, discarded } = stripHiddenAnswers(snapshot, parsed as Answers, visible);

  // 4. Validate only what survived.
  for (const field of allFields(snapshot)) {
    if (!visible.has(field.id)) continue;
    const value = clean[field.id];
    if (isEmpty(value)) {
      if (opts.requireRequired && field.required) fieldErrors[field.id] = `${field.label} is required`;
      continue;
    }
    const message = tooLong(field, value as AnswerValue) ?? invalidOption(field, value as AnswerValue);
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
    const target = byId.get(answer.fieldId)?.mapsTo;
    if (!target) continue;
    const text = answer.value.t === "s" ? answer.value.v : answer.value.t === "opt" ? answer.value.v : null;
    if (text === null) continue;
    switch (target) {
      case "submission.title": submission.title = text.slice(0, LIMITS.TITLE); break;
      case "submission.description_html": submission.descriptionHtml = text; break;
      case "submission.track_id": submission.trackId = text; break;
      case "submission.format_id": submission.formatId = text; break;
      case "submission.level": submission.level = text; break;
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
