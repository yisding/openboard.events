import { describe, expect, it } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { fileIdSchema, type AnswerValue, type FieldId, type FormSnapshot } from "@/shared/contracts";
import { FormUploadProvider } from "@/shared/ui/app/form-upload-context";
import { FormFieldRenderer, isRenderableFormField, toRichTextAnswer } from "./components/form-field-renderer";

Object.assign(globalThis, { React });

/**
 * The renderer itself is a React tree, and component tests are outside the test
 * budget (quality-strategy §3). What is worth pinning is the rule it renders by:
 * which fields it shows for a given set of answers must match what the submit
 * pipeline will keep, or a speaker fills in something the server then discards.
 */
const field = (key: string) => {
  const found = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
};

const option = (v: string): AnswerValue => ({ t: "opt", v });

describe("what the renderer shows", () => {
  it("hides a conditional field until its condition holds", () => {
    const talk = evaluateVisibility(GOLDEN_SNAPSHOT, { [field("format").id]: option("talk") } as Record<FieldId, AnswerValue>);
    expect(talk.has(field("workshop_duration").id)).toBe(false);

    const workshop = evaluateVisibility(GOLDEN_SNAPSHOT, { [field("format").id]: option("workshop") } as Record<FieldId, AnswerValue>);
    expect(workshop.has(field("workshop_duration").id)).toBe(true);
  });

  it("shows every unconditional field with no answers at all", () => {
    // The first paint of an empty wizard must not be blank.
    const visible = evaluateVisibility(GOLDEN_SNAPSHOT, {});
    expect(visible.has(field("title").id)).toBe(true);
    expect(visible.has(field("first_name").id)).toBe(true);
    expect(visible.has(field("workshop_duration").id)).toBe(false);
  });

  it("agrees with the section split the wizard renders in steps", () => {
    // sectionKeys is how the wizard shows one step at a time; the keys it passes
    // have to exist, or a step renders empty.
    const keys = GOLDEN_SNAPSHOT.sections.map((section) => section.key);
    expect(keys).toContain("abstract");
    expect(keys).toContain("participant");
  });
});

describe("form field controls", () => {
  const fileSnapshot = (): FormSnapshot => {
    const snapshot = structuredClone(GOLDEN_SNAPSHOT) as FormSnapshot;
    snapshot.sections = snapshot.sections.slice(0, 1).map((section) => ({
      ...section,
      descriptionHtml: "",
      fields: section.fields.filter((candidate) => candidate.key === "supporting"),
    }));
    return snapshot;
  };

  it("renders a real upload control for an editable file field", () => {
    const html = renderToStaticMarkup(createElement(
      FormUploadProvider,
      { eventId: "00000000-0000-4000-8000-000000000009" },
      createElement(FormFieldRenderer, {
        snapshot: fileSnapshot(),
        answers: {},
        onChange: () => undefined,
        mode: "edit",
      }),
    ));
    expect(html).toContain('type="file"');
    expect(html).toContain("Choose a file");
  });

  it("renders participant date questions with the shared themed calendar", () => {
    const snapshot = structuredClone(GOLDEN_SNAPSHOT) as FormSnapshot;
    const dateField = { ...field("title"), type: "date" as const, required: true };
    const firstSection = snapshot.sections[0];
    if (!firstSection) throw new Error("Expected a form section");
    snapshot.sections = [{ ...firstSection, fields: [dateField] }];
    const html = renderToStaticMarkup(createElement(FormFieldRenderer, {
      snapshot,
      answers: { [dateField.id]: { t: "d", v: "2026-09-15" } } as Record<FieldId, AnswerValue>,
      onChange: () => undefined,
      mode: "edit",
    }));

    expect(html).toContain('class="datetime-picker"');
    expect(html).toContain('value="Sep 15, 2026"');
    expect(html).toContain('aria-label="Open date picker"');
    expect(html).not.toContain(`type=${JSON.stringify("date")}`);
  });

  it("uses the authorized download flow for a private file answer", () => {
    const supporting = field("supporting");
    const html = renderToStaticMarkup(createElement(FormFieldRenderer, {
      snapshot: fileSnapshot(),
      answers: { [supporting.id]: { t: "file", v: fileIdSchema.parse("00000000-0000-4000-8000-000000000099") } } as Record<FieldId, AnswerValue>,
      onChange: () => undefined,
      mode: "review",
    }));
    expect(html).toContain("Uploaded file");
    expect(html).not.toContain("/f/");
  });

  it("does not retain empty rich-text markup as an answer", () => {
    expect(toRichTextAnswer("<p><br></p>")).toBeUndefined();
    expect(toRichTextAnswer("<p>Hello</p>")).toEqual({ t: "s", v: "<p>Hello</p>" });
  });

  it("connects required controls and server errors to their accessible field names", () => {
    const title = field("title");
    const topics = field("topics");
    const html = renderToStaticMarkup(createElement(FormFieldRenderer, {
      snapshot: GOLDEN_SNAPSHOT,
      answers: {},
      onChange: () => undefined,
      mode: "edit",
      errors: { [title.id]: "Add a title" },
    }));

    expect(html).toContain(`id="${title.id}"`);
    expect(html).toContain("required=\"\"");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`aria-describedby="${title.id}-error"`);
    expect(html).toContain(`id="${title.id}-error" role="alert"`);
    expect(html).toContain(`<legend class="sr-only">${topics.label}</legend>`);
  });

  it("hides optional choice questions until they have something to choose", () => {
    const snapshot = structuredClone(GOLDEN_SNAPSHOT) as FormSnapshot;
    const abstract = snapshot.sections.find((section) => section.key === "abstract");
    if (!abstract) throw new Error("Missing abstract section");
    const format = abstract.fields.find((candidate) => candidate.key === "format");
    const topics = abstract.fields.find((candidate) => candidate.key === "topics");
    if (!format || !topics) throw new Error("Missing choice fields");
    format.required = false;
    format.options = [];
    topics.required = false;
    topics.options = [];

    expect(isRenderableFormField(format)).toBe(false);
    expect(isRenderableFormField(topics)).toBe(false);
    const html = renderToStaticMarkup(createElement(FormFieldRenderer, {
      snapshot,
      answers: {},
      onChange: () => undefined,
      mode: "edit",
      sectionKeys: ["abstract"],
    }));
    expect(html).not.toContain(">Format<");
    expect(html).not.toContain(">Topics<");
    expect(html).toContain(">Title");
  });

  it("keeps a required empty choice visible so invalid configuration is not hidden", () => {
    const requiredEmpty = structuredClone(field("format"));
    requiredEmpty.required = true;
    requiredEmpty.options = [];
    expect(isRenderableFormField(requiredEmpty)).toBe(true);
  });

});
