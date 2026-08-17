import type { FormAuthoringRows, FormField, FormSnapshot, MapsToTarget } from "@/shared/contracts";
import { COMMITTED_FIELD_TYPES, LIMITS } from "@/shared/contracts";
import { AppError } from "./errors";

const REQUIRED_LOCKED_FIELDS: Record<MapsToTarget, { type: FormField["type"] }> = {
  "submission.title": { type: "text" },
  "contact.first_name": { type: "text" },
  "contact.last_name": { type: "text" },
  "contact.email": { type: "email" },
  "submission.description_html": { type: "richtext" },
  "submission.track_id": { type: "dropdown" },
  "submission.format_id": { type: "dropdown" },
  "submission.level": { type: "text" },
  "submission.language": { type: "text" },
  "contact.bio_html": { type: "richtext" },
  "contact.company": { type: "text" },
  "contact.job_title": { type: "text" },
  "contact.pronouns": { type: "text" },
  "contact.headshot_file_id": { type: "file" },
  "contact.linkedin_url": { type: "url" },
  "contact.twitter_url": { type: "url" },
  "contact.website_url": { type: "url" },
};

const LOCKED_TARGETS = ["submission.title", "contact.first_name", "contact.last_name", "contact.email"] as const;

function invalid(fieldId: string, message: string): never {
  throw new AppError("VALIDATION", `${fieldId}: ${message}`, { fieldId });
}

export function compileFormSnapshot(rows: FormAuthoringRows): FormSnapshot {
  const sections = [...rows.sections].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const sectionOrder = new Map(sections.map((section, index) => [section.id, index]));
  const fields = rows.fields
    .filter((field) => field.deletedAt === null)
    .sort((a, b) => {
      const bySection = (sectionOrder.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER) - (sectionOrder.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER);
      return bySection || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
    });
  const position = new Map(fields.map((field, index) => [field.id, index]));

  for (const field of fields) {
    if (!COMMITTED_FIELD_TYPES.includes(field.fieldType as (typeof COMMITTED_FIELD_TYPES)[number])) invalid(field.id, `unsupported committed field type ${field.fieldType}`);
    if (!sectionOrder.has(field.sectionId)) invalid(field.id, "references an unknown section");
    if (field.visibility) {
      for (const condition of field.visibility.conditions) {
        const sourcePosition = position.get(condition.sourceFieldId);
        const currentPosition = position.get(field.id);
        if (sourcePosition === undefined || currentPosition === undefined || sourcePosition >= currentPosition) invalid(field.id, `visibility source ${condition.sourceFieldId} must be an earlier field`);
        // The condition's *value*, not just its source. On an option-bearing
        // source the value is an option id, and until this check a value that
        // named nothing compiled happily into the snapshot the public form
        // renders from: `eq` stopped matching for every speaker, so the
        // dependent question was unreachable forever — or, with `neq`, shown
        // unconditionally. Two writers produced such values (the builder's
        // `draft-N` placeholders and the demo scaffold's option re-iding), and
        // nothing downstream could tell a dead id from a live one, because
        // both are just strings by the time a rule is evaluated.
        //
        // This is the backstop, not the friendly refusal: `guards.ts` catches
        // the two authoring shapes at the request that creates them and names
        // the questions involved. Reaching here means a writer outside the
        // builder produced a rule the builder would have rejected, and failing
        // the publish is how that stops being silent. Free-text sources are
        // exempt — `eq "90 minutes"` against a text question is prose an
        // organizer typed, not an id to resolve.
        const source = sourcePosition === undefined ? undefined : fields[sourcePosition];
        if (source && (source.fieldType === "dropdown" || source.fieldType === "multiselect") && condition.value !== undefined) {
          const live = new Set(source.options.map((option) => option.id));
          const values = Array.isArray(condition.value) ? condition.value : [condition.value];
          const dangling = values.find((value) => !live.has(value));
          if (dangling !== undefined) invalid(field.id, `visibility value ${dangling} is not an option of ${source.label}`);
        }
      }
    }
    const optionIds = new Set<string>();
    for (const option of field.options) {
      if (optionIds.has(option.id)) invalid(field.id, `duplicate option id ${option.id}`);
      optionIds.add(option.id);
    }
    if (field.maxChars !== null) {
      if (!Number.isSafeInteger(field.maxChars) || field.maxChars <= 0) invalid(field.id, "maxChars must be a positive integer");
      const max = field.mapsTo === "submission.title" ? LIMITS.TITLE : field.fieldType === "richtext" ? LIMITS.RICHTEXT : Number.MAX_SAFE_INTEGER;
      if (field.maxChars > max) invalid(field.id, `maxChars exceeds ${max}`);
    }
  }

  if (rows.form.context === "cfp") {
    for (const target of LOCKED_TARGETS) {
      const field = fields.find((candidate) => candidate.mapsTo === target);
      if (!field) throw new AppError("VALIDATION", `missing locked field ${target}`);
      const expected = REQUIRED_LOCKED_FIELDS[target];
      if (!field.locked || !field.required || field.fieldType !== expected.type) invalid(field.id, `${target} must remain locked, required, and ${expected.type}`);
    }
  }

  return {
    formId: rows.form.id,
    version: rows.form.version,
    context: rows.form.context,
    sections: sections.map((section) => ({
      id: section.id,
      key: section.key,
      title: section.title,
      pageHeading: section.pageHeading,
      descriptionHtml: section.descriptionHtml,
      fields: fields.filter((field) => field.sectionId === section.id).map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        type: field.fieldType,
        required: field.required,
        locked: field.locked,
        maxChars: field.maxChars,
        helpText: field.helpText,
        options: field.options,
        visibility: field.visibility,
        mapsTo: field.mapsTo,
        // M50: the snapshot is what blind review consults, so the
        // classification is pinned here with the rest of the question. Locked
        // contact fields are identity by construction — an organizer cannot
        // opt the speaker's own name or email into a blind reviewer's view.
        reviewVisibility: field.locked ? "identity" : field.reviewVisibility ?? "identity",
      })),
    })),
  };
}
