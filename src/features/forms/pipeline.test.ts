import { describe, expect, it } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { cleanAnswersSchema, type AnswerValue, type FormSnapshot } from "@/shared/contracts";
import { deriveMappedFields, isStructurallyCompatible, runSubmitPipeline } from "./index";

const fieldByKey = (key: string) => {
  const field = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!field) throw new Error(`the golden fixture has no field ${key}`);
  return field;
};

const TITLE = fieldByKey("title");
const DESCRIPTION = fieldByKey("description");
const TRACK = fieldByKey("track");
const FORMAT = fieldByKey("format");
const WORKSHOP_DURATION = fieldByKey("workshop_duration");
const FIRST = fieldByKey("first_name");
const LAST = fieldByKey("last_name");
const EMAIL = fieldByKey("email");
const TOPICS = fieldByKey("topics");
const SLIDES = fieldByKey("slides");
const SUPPORTING = fieldByKey("supporting");
const NOTES = fieldByKey("notes");

const text = (v: string): AnswerValue => ({ t: "s", v });
const option = (v: string): AnswerValue => ({ t: "opt", v });

/** Everything a complete abstract needs, so each case changes one thing. */
function completeAnswers(): Record<string, AnswerValue> {
  return {
    [TITLE.id]: text("Caching at the edge"),
    [DESCRIPTION.id]: text("<p>How we made it fast</p>"),
    [TRACK.id]: option("platforms"),
    [FORMAT.id]: option("talk"),
    [FIRST.id]: text("Ada"),
    [LAST.id]: text("Lovelace"),
    [EMAIL.id]: text("ada@example.com"),
  };
}

describe("runSubmitPipeline", () => {
  it("brands a complete submission and reports nothing discarded", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, completeAnswers(), { requireRequired: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discarded).toEqual([]);
    expect(result.clean).toHaveLength(7);
    expect(result.clean.every((answer) => answer.participantId === null)).toBe(true);
  });

  it("drops an answer to a field the speaker can no longer see", () => {
    // The classic bug this exists to prevent: pick Workshop, answer the
    // workshop-only question, switch back to Talk, submit — and the stale answer
    // must not be stored.
    const answers = { ...completeAnswers(), [FORMAT.id]: option("talk"), [WORKSHOP_DURATION.id]: text("90 minutes") };
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, answers, { requireRequired: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discarded).toContain(WORKSHOP_DURATION.id);
    expect(result.clean.map((answer) => answer.fieldId)).not.toContain(WORKSHOP_DURATION.id);
  });

  it("keeps the conditional answer when its condition holds", () => {
    const answers = { ...completeAnswers(), [FORMAT.id]: option("workshop"), [WORKSHOP_DURATION.id]: text("90 minutes") };
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, answers, { requireRequired: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clean.map((answer) => answer.fieldId)).toContain(WORKSHOP_DURATION.id);
  });

  it("reports a field error per missing required field, and writes nothing", () => {
    const rest = completeAnswers();
    delete rest[TITLE.id];
    delete rest[TRACK.id];
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, rest, { requireRequired: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
    expect(Object.keys(result.fieldErrors).sort()).toEqual([TITLE.id, TRACK.id].sort());
  });

  it("treats whitespace as missing", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [TITLE.id]: text("   ") }, { requireRequired: true });
    expect(result.ok).toBe(false);
  });

  it("treats an empty single-choice value as missing", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [TRACK.id]: option("") }, { requireRequired: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors[TRACK.id]).toContain("required");
  });

  it("treats markup with no text as a missing rich-text answer", () => {
    const result = runSubmitPipeline(
      GOLDEN_SNAPSHOT,
      { ...completeAnswers(), [DESCRIPTION.id]: text("<p><br></p>") },
      { requireRequired: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors[DESCRIPTION.id]).toContain("required");
  });

  it("does not require required fields on a draft save", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { [TITLE.id]: text("Just the title so far") }, { requireRequired: false });
    expect(result.ok).toBe(true);
  });

  it("never requires a hidden field, even a required one", () => {
    // Required *and* invisible means the form is not asking, so demanding it
    // would trap a speaker behind an error they cannot clear.
    const snapshot = structuredClone(GOLDEN_SNAPSHOT) as FormSnapshot;
    const conditional = snapshot.sections.flatMap((section) => section.fields).find((field) => field.key === "workshop_duration");
    if (conditional) conditional.required = true;

    const result = runSubmitPipeline(snapshot, { ...completeAnswers(), [FORMAT.id]: option("talk") }, { requireRequired: true });
    expect(result.ok).toBe(true);
  });

  it("refuses an option that is not on the field", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [TRACK.id]: option("not-a-track") }, { requireRequired: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors[TRACK.id]).toContain("offered options");
  });

  it.each([
    ["text", TITLE.id, option("not-text")],
    ["dropdown", TRACK.id, text("platforms")],
    ["multiselect", TOPICS.id, option("evals")],
    ["file", SUPPORTING.id, text("not-a-file-answer")],
  ])("rejects a valid AnswerValue with the wrong %s field type", (_name, fieldId, value) => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [fieldId]: value }, { requireRequired: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors[fieldId]).toContain("expected answer type");
  });

  it.each([
    ["an optional text field with an empty option", NOTES.id, option(""), true],
    ["an optional text field with an empty option list", NOTES.id, { t: "opts", v: [] } satisfies AnswerValue, true],
    ["a required text field during a draft save", TITLE.id, { t: "opts", v: [] } satisfies AnswerValue, false],
  ])("rejects the wrong empty discriminator for %s", (_name, fieldId, value, requireRequired) => {
    const result = runSubmitPipeline(
      GOLDEN_SNAPSHOT,
      { ...completeAnswers(), [fieldId]: value },
      { requireRequired },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors[fieldId]).toContain("expected answer type");
  });

  it("validates email and URL string formats", () => {
    const badEmail = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [EMAIL.id]: text("not an email") }, { requireRequired: true });
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.fieldErrors[EMAIL.id]).toContain("valid email");

    const badUrl = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [SLIDES.id]: text("not a URL") }, { requireRequired: true });
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.fieldErrors[SLIDES.id]).toContain("valid URL");
  });

  it("returns validation instead of throwing for a malformed known value", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [EMAIL.id]: null }, { requireRequired: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors[EMAIL.id]).toContain("expected answer type");
  });

  it("discards a malformed hidden answer instead of validating it", () => {
    const result = runSubmitPipeline(
      GOLDEN_SNAPSHOT,
      { ...completeAnswers(), [FORMAT.id]: option("talk"), [WORKSHOP_DURATION.id]: option("wrong-for-text") },
      { requireRequired: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discarded).toContain(WORKSHOP_DURATION.id);
  });

  it("counts rich text length on text, not on markup", () => {
    const padded = `<p><b>${"a".repeat(4_990)}</b></p>`;
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [DESCRIPTION.id]: text(padded) }, { requireRequired: true });
    // The markup pushes the raw string past 5,000 while the words do not.
    expect(padded.length).toBeGreaterThan(5_000);
    expect(result.ok).toBe(true);
  });

  it("sanitizes rich text on the way in", () => {
    const result = runSubmitPipeline(
      GOLDEN_SNAPSHOT,
      { ...completeAnswers(), [DESCRIPTION.id]: text("<p>Hi</p><script>alert(1)</script>") },
      { requireRequired: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.clean.find((answer) => answer.fieldId === DESCRIPTION.id);
    expect(stored?.value.t === "s" && stored.value.v).not.toContain("<script");
  });

  it("stamps the participant id it is given", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, completeAnswers(), { requireRequired: false, participantId: "p1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clean.every((answer) => answer.participantId === "p1")).toBe(true);
  });

  it("discards an answer to a field the snapshot does not contain", () => {
    const result = runSubmitPipeline(
      GOLDEN_SNAPSHOT,
      { ...completeAnswers(), "11111111-1111-4111-8111-111111111111": text("from a different form") },
      { requireRequired: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discarded).toContain("11111111-1111-4111-8111-111111111111");
  });
});

describe("deriveMappedFields", () => {
  it("fills the typed columns a form promised to fill", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, completeAnswers(), { requireRequired: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mapped = deriveMappedFields(GOLDEN_SNAPSHOT, result.clean);
    expect(mapped.submission.title).toBe("Caching at the edge");
    expect(mapped.submission.descriptionHtml).toContain("How we made it fast");
    expect(mapped.contact).toEqual({ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" });
  });

  it("truncates a title to the column's width rather than failing the write", () => {
    // The pipeline rejects an over-long title against the field's own maxChars,
    // so this guards the other route in: a form authored without one still
    // cannot overflow a varchar(255) and lose the whole submission.
    const clean = cleanAnswersSchema.parse([{ fieldId: TITLE.id, participantId: null, value: text("a".repeat(300)) }]);
    expect(deriveMappedFields(GOLDEN_SNAPSHOT, clean).submission.title).toHaveLength(255);
  });

  it("stores a dropdown level's semantic label instead of its option id", () => {
    const snapshot = structuredClone(GOLDEN_SNAPSHOT) as FormSnapshot;
    const notes = snapshot.sections.flatMap((section) => section.fields).find((field) => field.key === "notes");
    if (!notes) throw new Error("notes field missing");
    notes.type = "dropdown";
    notes.options = [{ id: "level-beginner", label: "Beginner" }];
    notes.mapsTo = "submission.level";
    const clean = cleanAnswersSchema.parse([{ fieldId: notes.id, participantId: null, value: { t: "opt", v: "level-beginner" } }]);
    expect(deriveMappedFields(snapshot, clean).submission.level).toBe("Beginner");
  });

  it("rejects an over-long title through the pipeline, before it reaches a column", () => {
    const result = runSubmitPipeline(GOLDEN_SNAPSHOT, { ...completeAnswers(), [TITLE.id]: text("a".repeat(300)) }, { requireRequired: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors[TITLE.id]).toContain("255");
  });
});

describe("isStructurallyCompatible", () => {
  const clone = () => structuredClone(GOLDEN_SNAPSHOT) as FormSnapshot;

  it("accepts a cosmetic edit", () => {
    const next = clone();
    const field = next.sections[0]?.fields[0];
    if (field) { field.label = "Session title"; field.helpText = "Keep it short"; }
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, next)).toBe(true);
  });

  it("rejects a field whose type changed", () => {
    const next = clone();
    const field = next.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "notes");
    if (field) field.type = "dropdown";
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, next)).toBe(false);
  });

  it("rejects a newly required field, old or new", () => {
    const madeRequired = clone();
    const notes = madeRequired.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "notes");
    if (notes) notes.required = true;
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, madeRequired)).toBe(false);

    const added = clone();
    const section = added.sections[0];
    const template = section?.fields[0];
    if (section && template) {
      section.fields.push({ ...template, id: "99999999-9999-4999-8999-999999999999" as typeof template.id, key: "new_required", required: true });
    }
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, added)).toBe(false);
  });

  it("accepts a removed field, because the pipeline strips unknown answers", () => {
    const next = clone();
    const section = next.sections[0];
    if (section) section.fields = section.fields.filter((field) => field.key !== "notes");
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, next)).toBe(true);
  });

  it("rejects a removed option but accepts a new one", () => {
    const removed = clone();
    const track = removed.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "track");
    if (track) track.options = track.options.filter((choice) => choice.id !== "platforms");
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, removed)).toBe(false);

    const added = clone();
    const trackWithExtra = added.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "track");
    const first = trackWithExtra?.options[0];
    if (trackWithExtra && first) trackWithExtra.options.push({ ...first, id: "hardware", label: "Hardware" });
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, added)).toBe(true);
  });

  it("rejects a changed visibility rule", () => {
    const next = clone();
    const conditional = next.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "workshop_duration");
    if (conditional) conditional.visibility = null;
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, next)).toBe(false);
  });

  it("rejects a changed field mapping", () => {
    const next = clone();
    const company = next.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "company");
    if (company) company.mapsTo = "contact.job_title";
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, next)).toBe(false);
  });

  it("rejects a snapshot for a different form outright", () => {
    const next = clone();
    next.formId = "88888888-8888-4888-8888-888888888888" as typeof next.formId;
    expect(isStructurallyCompatible(GOLDEN_SNAPSHOT, next)).toBe(false);
  });
});
