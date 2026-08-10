"use client";

import { Eye } from "lucide-react";
import { useState } from "react";
import type { AnswerValue, FieldId, FormSnapshot } from "@/shared/contracts";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { FormFieldRenderer } from "../form-field-renderer";

/**
 * The builder's live show/hide preview. Renders the current snapshot through
 * the same `<FormFieldRenderer>` every other surface uses (R12: every
 * show/hide decision on screen calls `evaluateVisibility` — there is no
 * second implementation), with local, never-persisted answers so an
 * organizer can see a conditional field appear and disappear without a save
 * or a network round trip.
 */
export function BuilderPreview({ snapshot }: { snapshot: FormSnapshot }) {
  const [answers, setAnswers] = useState<Record<FieldId, AnswerValue | undefined>>({});
  const visible = evaluateVisibility(snapshot, answers);
  const total = snapshot.sections.reduce((sum, section) => sum + section.fields.length, 0);

  function handleChange(fieldId: FieldId, value: AnswerValue | undefined) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
  }

  return (
    <div className="preview-pane builder-live-preview">
      <header>
        <span>PREVIEW</span>
        <b>Answers here are not saved.</b>
      </header>
      <div className="builder-live-preview__body">
        <FormFieldRenderer snapshot={snapshot} answers={answers} mode="edit" onChange={handleChange} />
      </div>
      <p className="preview-hint">
        <Eye size={14} /> {visible.size} of {total} question{total === 1 ? "" : "s"} currently visible.
      </p>
    </div>
  );
}
