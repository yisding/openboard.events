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
      })),
    })),
  };
}
