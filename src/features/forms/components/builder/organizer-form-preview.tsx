"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import type { AnswerValue, FieldId, FormSnapshot } from "@/shared/contracts";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import type { BuilderEvent, BuilderForm } from "../../builder-types";
import { tryCompileBuilderSnapshot } from "../../form-builder-state";
import { FormFieldRenderer, isRenderableFormField } from "../form-field-renderer";

function runtimeSnapshot(form: BuilderForm): FormSnapshot | null {
  const snapshot = tryCompileBuilderSnapshot(form);
  if (!snapshot || form.collectParticipants) return snapshot;
  return {
    ...snapshot,
    sections: snapshot.sections.filter((section) => section.key !== "participant"),
  };
}

/**
 * A safe organizer preview of the currently saved form configuration.
 *
 * It deliberately reuses the same snapshot compiler, visibility evaluator,
 * and field renderer as the public CFP, but keeps every answer in component
 * state. Visiting this surface never creates a portal session, draft, contact,
 * or onboarding milestone; the separately labelled live-form link is the only
 * route into the real speaker journey.
 */
export function OrganizerFormPreview({ event, form }: { event: BuilderEvent; form: BuilderForm }) {
  const snapshot = useMemo(() => runtimeSnapshot(form), [form]);
  const [answers, setAnswers] = useState<Record<FieldId, AnswerValue | undefined>>({});
  const builderHref = `/events/${event.id}/forms/${form.id}`;
  const liveHref = `/submit/${event.slug}/${form.id}`;
  const sections = snapshot?.sections.filter((section) => section.fields.some(isRenderableFormField)) ?? [];

  function handleChange(fieldId: FieldId, value: AnswerValue | undefined) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
  }

  return (
    <div className="organizer-form-preview">
      <header className="organizer-form-preview__header">
        <div>
          <span>ORGANIZER PREVIEW</span>
          <h1>{form.externalTitle}</h1>
          <p>{event.name} · Saved form version {form.currentVersion}</p>
        </div>
        <div className="organizer-form-preview__actions">
          <Link className="button button-secondary" href={builderHref}><ArrowLeft size={16} /> Back to builder</Link>
          <Link className="button button-secondary" href={liveHref} target="_blank" rel="noreferrer">Open live form <ExternalLink size={16} /></Link>
        </div>
      </header>

      <aside className="organizer-form-preview__notice" role="note">
        <Eye size={18} aria-hidden="true" />
        <div>
          <b>Try the form without creating a submission</b>
          <span>Answers stay in this tab and are never saved. Conditional questions update as you answer.</span>
        </div>
      </aside>

      <div className="organizer-form-preview__canvas">
        {form.showWelcome && (
          <section className="organizer-form-preview__welcome" aria-labelledby="organizer-preview-welcome-title">
            <span>WELCOME SCREEN</span>
            <h2 id="organizer-preview-welcome-title">{form.pageHeading}</h2>
            {form.welcomeHtml && <RichTextView html={form.welcomeHtml} />}
          </section>
        )}

        {!snapshot ? (
          <section className="organizer-form-preview__unavailable" role="alert">
            <h2>Preview temporarily unavailable</h2>
            <p>Return to the builder and finish the incomplete question or visibility rule.</p>
            <Link className="button button-primary" href={builderHref}>Back to builder</Link>
          </section>
        ) : sections.length === 0 ? (
          <section className="organizer-form-preview__unavailable">
            <h2>No answerable questions yet</h2>
            <p>Add a question or choices in the builder, then return to preview it here.</p>
            <Link className="button button-primary" href={builderHref}>Add questions</Link>
          </section>
        ) : sections.map((section) => (
          <section className="organizer-form-preview__section" key={section.id} aria-labelledby={`organizer-preview-section-${section.id}`}>
            <header>
              <span>{section.key === "participant" ? "SPEAKER DETAILS" : "PROPOSAL"}</span>
              <h2 id={`organizer-preview-section-${section.id}`}>{section.pageHeading || section.title}</h2>
            </header>
            <FormFieldRenderer
              snapshot={snapshot}
              answers={answers}
              mode="edit"
              onChange={handleChange}
              sectionKeys={[section.key]}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
