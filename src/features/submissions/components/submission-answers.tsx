"use client";

import type { AnswerPanelData } from "@/shared/contracts";
import { FormFieldRenderer } from "@/features/forms/index.client";

/**
 * What the submitter actually typed, rendered against the *pinned* snapshot — a
 * question renamed after the fact still reads the way they answered it.
 *
 * One renderer, two consumers: the organizer's drawer and the reviewer's queue.
 * A second copy would drift on the pinned-snapshot rule, and a reviewer scoring
 * a differently-rendered version of the proposal is the failure this shape
 * exists to prevent.
 */

/** The answers belonging to one participant, or the submission-level ones. */
function answersFor(data: AnswerPanelData, participantId: string | null) {
  return Object.fromEntries(
    data.answers
      .filter((answer) => answer.participantId === participantId)
      .map((answer) => [answer.fieldId, answer.value]),
  );
}

export function SubmissionAnswers({ data }: { data: AnswerPanelData }) {
  const snapshot = data.snapshot;
  if (!snapshot) {
    return <p className="portal-note">This submission was created without a form, so there are no questions to show.</p>;
  }
  return (
    <>
      <p className="pinned-note">Rendered against form version {data.formVersion}, as the speaker saw it.</p>
      <FormFieldRenderer snapshot={snapshot} answers={answersFor(data, null)} onChange={() => undefined} mode="review" />
      {/* Participant questions are stored per speaker, so a form that asks each
          of them for a bio has one set of answers per person. Rendering only the
          unscoped ones drops every one of them. */}
      {data.participants
        .filter((participant) => data.answers.some((answer) => answer.participantId === participant.id))
        .map((participant) => (
          <div key={participant.id} className="drawer-participant-answers">
            <h4>{participant.name}</h4>
            <FormFieldRenderer snapshot={snapshot} answers={answersFor(data, participant.id)} onChange={() => undefined} mode="review" />
          </div>
        ))}
    </>
  );
}
