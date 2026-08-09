import type { FormSnapshot } from "@/shared/contracts";

/**
 * Whether answers rendered against one snapshot can still be submitted against
 * another.
 *
 * Structural, not cosmetic: an organizer fixing a typo in a label must not throw
 * away a wizard a speaker has half-filled, while a question that changed type or
 * lost its options would silently store an answer that no longer means anything.
 *
 * A field disappearing is compatible — the pipeline strips unknown answers
 * anyway. A field appearing is compatible unless it is required, because then
 * the speaker would submit something the form now considers incomplete.
 */
export function isStructurallyCompatible(rendered: FormSnapshot, current: FormSnapshot): boolean {
  if (rendered.formId !== current.formId) return false;

  const renderedFields = new Map(rendered.sections.flatMap((section) => section.fields).map((field) => [field.id, field]));
  const currentFields = new Map(current.sections.flatMap((section) => section.fields).map((field) => [field.id, field]));

  for (const [id, field] of currentFields) {
    const before = renderedFields.get(id);
    if (!before) {
      if (field.required) return false;
      continue;
    }
    if (before.type !== field.type) return false;
    if (!before.required && field.required) return false;
    // Options the speaker could pick must still be pickable; new ones are fine.
    const options = new Set(field.options.map((option) => option.id));
    if (before.options.some((option) => !options.has(option.id))) return false;
    // A visibility rule appearing or changing can hide an answer the speaker
    // already gave, which changes what they are submitting.
    if (JSON.stringify(before.visibility ?? null) !== JSON.stringify(field.visibility ?? null)) return false;
  }
  return true;
}
