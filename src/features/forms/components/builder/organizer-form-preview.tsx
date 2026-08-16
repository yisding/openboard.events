"use client";

import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import type { AnswerValue, FieldId, FormSnapshot } from "@/shared/contracts";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import type { BuilderEvent, BuilderForm } from "../../builder-types";
import { tryCompileBuilderSnapshot } from "../../form-builder-state";
import { formAvailability } from "../../lib/form-open";
import { FormFieldRenderer, isRenderableFormField } from "../form-field-renderer";
import { SavedFormActions } from "../saved-form-actions";

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
export function OrganizerFormPreview({ event, form, nowIso }: { event: BuilderEvent; form: BuilderForm; nowIso: string }) {
  const snapshot = useMemo(() => runtimeSnapshot(form), [form]);
  const [answers, setAnswers] = useState<Record<FieldId, AnswerValue | undefined>>({});
  const builderHref = `/events/${event.id}/forms/${form.id}`;
  const availability = formAvailability(form, nowIso);
  const sections = snapshot?.sections.filter((section) => section.fields.some(isRenderableFormField)) ?? [];

  /**
   * Which section, if any, is currently showing a question that only exists
   * because of an answer given above it.
   *
   * This is the guided tour's one `data-tour` in the forms feature, and it is
   * an attribute rather than an element on purpose: the section is always
   * rendered, so the *attribute* appearing is exactly the event the tour is
   * waiting for — "a question you did not put on this page just appeared". It
   * reads the same evaluator the renderer does, so the marker cannot disagree
   * with what is on screen.
   */
  const visibleFieldIds = snapshot ? evaluateVisibility(snapshot, answers) : new Set<FieldId>();
  const conditionalSectionId = sections.find((section) => section.fields.some(
    (field) => field.visibility !== null && visibleFieldIds.has(field.id),
  ))?.id ?? null;

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
          <SavedFormActions
            availability={availability}
            eventSlug={event.slug}
            formId={form.id}
            formName={form.internalName}
            status={form.status}
            opensAt={form.opensAt}
            closesAt={form.closesAt}
          />
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
          <section
            className="organizer-form-preview__section"
            key={section.id}
            aria-labelledby={`organizer-preview-section-${section.id}`}
            {...(section.id === conditionalSectionId ? { "data-tour": "forms.workshop-duration" } : {})}
          >
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
