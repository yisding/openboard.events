import type { COMMITTED_FIELD_TYPES, MapsToTarget, TaskTarget } from "@/shared/contracts";

/**
 * The standard-field library (plan/modules/M24-portal-form-builder.md §5) —
 * exactly 8 triples, hardcoded, not admin-extensible. This is a deliberate
 * scope cut: do not add entries here without re-reading that section first.
 *
 * Naming gotcha (§5): PLAN.md's prose calls the rich-text committed type
 * "wysiwyg"; the DB enum value — and the value used below — is `richtext`.
 * There is no `'wysiwyg'` value in `form_fields.field_type`.
 */
export type StandardFieldItem = {
  /** Stable key for this library entry (not the authored field's `key`, which is derived from its label at creation). */
  libraryKey: string;
  label: string;
  fieldType: (typeof COMMITTED_FIELD_TYPES)[number];
  mapsTo: MapsToTarget;
  targetType: TaskTarget;
  /** `submission.level` is free-text vocab, not FK-bound (no trackId/formatId/tagId on its options) — these are plain authored labels, same shape createFieldIn already gives a fresh dropdown. */
  defaultOptionLabels?: readonly string[];
};

export const STANDARD_FIELD_LIBRARY: readonly StandardFieldItem[] = [
  { libraryKey: "bio", label: "Bio", fieldType: "richtext", mapsTo: "contact.bio_html", targetType: "contact" },
  { libraryKey: "headshot", label: "Headshot", fieldType: "file", mapsTo: "contact.headshot_file_id", targetType: "contact" },
  { libraryKey: "pronouns", label: "Pronouns", fieldType: "text", mapsTo: "contact.pronouns", targetType: "contact" },
  { libraryKey: "company", label: "Company", fieldType: "text", mapsTo: "contact.company", targetType: "contact" },
  { libraryKey: "job_title", label: "Job Title", fieldType: "text", mapsTo: "contact.job_title", targetType: "contact" },
  { libraryKey: "session_title", label: "Session Title", fieldType: "text", mapsTo: "submission.title", targetType: "submission" },
  { libraryKey: "session_description", label: "Session Description", fieldType: "richtext", mapsTo: "submission.description_html", targetType: "submission" },
  {
    libraryKey: "session_level",
    label: "Session Level",
    fieldType: "dropdown",
    mapsTo: "submission.level",
    targetType: "submission",
    defaultOptionLabels: ["Beginner", "Intermediate", "Advanced"],
  },
] as const;

export function standardFieldsFor(targetType: TaskTarget): readonly StandardFieldItem[] {
  return STANDARD_FIELD_LIBRARY.filter((item) => item.targetType === targetType);
}

const CUSTOM_TYPE_LABELS: Record<(typeof COMMITTED_FIELD_TYPES)[number], string> = {
  text: "Short text",
  textarea: "Long text",
  richtext: "Rich Text",
  dropdown: "Dropdown",
  multiselect: "Multi-select",
  email: "Email",
  url: "Website",
  file: "File upload",
};

export function committedTypeLabel(fieldType: (typeof COMMITTED_FIELD_TYPES)[number]): string {
  return CUSTOM_TYPE_LABELS[fieldType];
}
