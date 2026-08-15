import type { AnswerPanelData, FormSnapshot, SubmissionDetailDTO } from "@/shared/contracts";

/**
 * M50 — blind review, enforced while the server builds the DTO.
 *
 * Blindness is a property of the payload, not of the screen: this runs before
 * serialization, so there is no version of the reviewer's response that ever
 * contained the author's name. Hiding a row in the UI is not anonymization, and
 * a client that asks for the raw route gets the same redacted object.
 *
 * The *only* classifier is the submission's pinned snapshot. Section names,
 * the current form's metadata, field keys and `maps_to` guesses are all
 * deliberately ignored: they drift, and a heuristic that drifts leaks. A field
 * the snapshot does not classify — including every field in a snapshot compiled
 * before M50 — counts as `identity`, so unknown metadata omits an answer rather
 * than exposing one.
 */

function contentFieldIds(snapshot: FormSnapshot | null): Set<string> {
  const ids = new Set<string>();
  if (!snapshot) return ids;
  for (const section of snapshot.sections) {
    for (const field of section.fields) {
      // `locked` is belt-and-braces: `compileFormSnapshot` already pins locked
      // contact fields to `identity`, and an older snapshot has no value at all.
      if (!field.locked && field.reviewVisibility === "content") ids.add(field.id);
    }
  }
  return ids;
}

/**
 * A surviving content field keeps its conditional rule only if every source it
 * names survived too.
 *
 * The reviewer's answer panel renders through `FormFieldRenderer`, which
 * re-runs `evaluateVisibility` against the blinded snapshot. A rule whose
 * source was stripped as identity therefore resolves against an answer that is
 * no longer there: `answered`/`eq`/`in` all read `undefined` as false and hide
 * the field. So blinding could remove a *content* answer the reviewer is meant
 * to score — "Workshop duration", shown only when an identity question was
 * answered, silently disappears.
 *
 * The rule cannot be evaluated once its source is gone, so it is dropped
 * rather than left to fail one way. What the submitter actually filled in is
 * already what `answers` carries.
 */
function withEvaluableVisibility(allowed: ReadonlySet<string>) {
  return <T extends { visibility?: { conditions: { sourceFieldId: string }[] } | null }>(field: T): T => {
    if (!field.visibility) return field;
    const evaluable = field.visibility.conditions.every((condition) => allowed.has(condition.sourceFieldId));
    return evaluable ? field : { ...field, visibility: null };
  };
}

function blindAnswerPanel(panel: AnswerPanelData): AnswerPanelData {
  const allowed = contentFieldIds(panel.snapshot);
  const answers = panel.answers.filter((answer) => allowed.has(answer.fieldId));
  const keptFileIds = new Set<string>(answers.flatMap((answer) => answer.value.t === "file" ? [answer.value.v as string] : []));
  return {
    formVersion: panel.formVersion,
    snapshot: panel.snapshot === null ? null : {
      ...panel.snapshot,
      sections: panel.snapshot.sections
        .map((section) => ({
          ...section,
          fields: section.fields.filter((field) => allowed.has(field.id)).map(withEvaluableVisibility(allowed)),
        }))
        // A section left with no content questions is itself a hint about the
        // form ("Speaker details"), so it goes too.
        .filter((section) => section.fields.length > 0),
    },
    answers,
    // Per-participant answers are attributed answers; without the participant
    // list they cannot be rendered, and with it the panel would name people.
    participants: [],
    files: Object.fromEntries(Object.entries(panel.files).filter(([fileId]) => keptFileIds.has(fileId))),
  };
}

/**
 * The reviewer's copy of a submission when the round anonymizes authors: the
 * proposal's own content, and nothing that identifies who wrote it. The
 * organizer's DTO is never passed through here.
 */
export function anonymizeSubmissionDetail(detail: SubmissionDetailDTO): SubmissionDetailDTO {
  return {
    ...detail,
    submitterEmail: null,
    submitterName: null,
    speakers: [],
    participants: [],
    answerPanel: blindAnswerPanel(detail.answerPanel),
  };
}
