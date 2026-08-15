import { describe, expect, it } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import type { AnswerPanelData, FormSnapshot, SubmissionDetailDTO } from "@/shared/contracts";
import { anonymizeSubmissionDetail } from "./blind";

/**
 * The reviewer's answer panel renders through `FormFieldRenderer`, which
 * re-runs `evaluateVisibility` against whatever snapshot it is handed. So the
 * blinded snapshot has to be internally consistent, not merely smaller.
 */
function fields(snapshot: FormSnapshot | null) {
  return (snapshot?.sections ?? []).flatMap((section) => section.fields);
}

function panelWith(snapshot: FormSnapshot): AnswerPanelData {
  return { formVersion: 1, snapshot, answers: [], participants: [], files: {} };
}

function detailWith(panel: AnswerPanelData): SubmissionDetailDTO {
  return { answerPanel: panel, speakers: [], participants: [] } as unknown as SubmissionDetailDTO;
}

describe("anonymizeSubmissionDetail", () => {
  // The fixture compiles every field to `identity` (fail-closed, per
  // `compileFormSnapshot`), so the two the reviewer is meant to see are marked
  // here rather than assumed.
  const content = () => {
    const snapshot = structuredClone(GOLDEN_SNAPSHOT) as FormSnapshot;
    const all = fields(snapshot);
    const unlocked = all.filter((field) => !field.locked);
    const [source, dependent] = unlocked;
    const identityField = all.find((field) => field.locked);
    if (!source || !dependent || !identityField) throw new Error("fixture needs two unlocked fields and a locked one");
    source.reviewVisibility = "content";
    dependent.reviewVisibility = "content";
    return { snapshot, contentFields: [source, dependent], identityField };
  };

  it("drops a rule whose source was stripped, rather than leaving it unevaluable", () => {
    const { snapshot, contentFields, identityField } = content();
    const dependent = contentFields[1];
    if (!dependent) throw new Error("fixture needs a second content field");
    dependent.visibility = { match: "all", conditions: [{ sourceFieldId: identityField.id, op: "answered" }] };

    const blinded = anonymizeSubmissionDetail(detailWith(panelWith(snapshot)));

    const survivor = fields(blinded.answerPanel.snapshot).find((field) => field.id === dependent.id);
    // The source is gone, so `answered` would read undefined and hide a content
    // answer the reviewer is meant to score.
    expect(fields(blinded.answerPanel.snapshot).some((field) => field.id === identityField.id)).toBe(false);
    expect(survivor).toBeDefined();
    expect(survivor?.visibility ?? null).toBeNull();
  });

  it("keeps a rule whose sources all survived", () => {
    const { snapshot, contentFields } = content();
    const [source, dependent] = contentFields;
    if (!source || !dependent) throw new Error("fixture needs two content fields");
    dependent.visibility = { match: "all", conditions: [{ sourceFieldId: source.id, op: "answered" }] };

    const blinded = anonymizeSubmissionDetail(detailWith(panelWith(snapshot)));

    const survivor = fields(blinded.answerPanel.snapshot).find((field) => field.id === dependent.id);
    expect(survivor?.visibility?.conditions[0]?.sourceFieldId).toBe(source.id);
  });

  it("still removes identity fields and the people they name", () => {
    const { snapshot } = content();
    const blinded = anonymizeSubmissionDetail(detailWith(panelWith(snapshot)));

    expect(fields(blinded.answerPanel.snapshot).every((field) => !field.locked && field.reviewVisibility === "content")).toBe(true);
    expect(blinded.submitterEmail).toBeNull();
    expect(blinded.submitterName).toBeNull();
    expect(blinded.answerPanel.participants).toEqual([]);
  });
});
