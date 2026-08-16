/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionVocabulary } from "@/features/submissions";
import { AbstractFields, EMPTY_ABSTRACT_FIELDS } from "./abstract-fields";

/**
 * The eleven fields the abstract drawer edits.
 *
 * Chrome's accessibility panel found every one of them anonymous: no `id`, no
 * `name`, and — for the description — no label at all, because the wrapping
 * `<label>` had claimed the rich text editor's Bold button instead of the
 * textbox. This walks the rendered form the way a screen reader or an autofill
 * heuristic does rather than asserting one component's markup, so a field added
 * later is held to the same rule.
 */
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({
  RichTextEditor: ({ ariaLabel }: { ariaLabel: string }) => (
    <div className="rich-text-editor">
      <div role="toolbar" aria-label="Formatting"><button type="button" aria-label="Bold">B</button></div>
      <div role="textbox" aria-multiline="true" aria-label={ariaLabel} />
    </div>
  ),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const vocabulary: SubmissionVocabulary = {
  tracks: [{ id: "track-1", name: "Platform", color: "#336699" }],
  formats: [{ id: "format-1", name: "Workshop" }],
  tags: [{ id: "tag-1", name: "Advanced" }],
};

let container: HTMLDivElement;
let root: Root;

function controls(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("input, select, textarea")];
}

/**
 * The name a browser would compute for this control, or "" when it has none.
 * `Field` puts the caption in the label's first `<span>`; the rest of the
 * label is the character counter and the hint.
 */
function accessibleName(control: HTMLElement): string {
  const aria = control.getAttribute("aria-label");
  if (aria) return aria;
  const labelled = control.id
    ? container.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(control.id)}"]`)
    : null;
  const label = labelled ?? control.closest("label");
  return (label?.querySelector("span") ?? label)?.textContent?.trim() ?? "";
}

/** The control the visible caption `text` is associated with, if any. */
function controlLabelled(text: string): HTMLElement | undefined {
  return controls().find((control) => accessibleName(control).replace(/\s*\*$/u, "") === text);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the abstract drawer's Details form", () => {
  beforeEach(async () => {
    await act(async () => root.render(
      <AbstractFields
        values={EMPTY_ABSTRACT_FIELDS}
        onChange={() => undefined}
        vocabulary={vocabulary}
        timezone="America/Los_Angeles"
      />,
    ));
  });

  it("gives every control a name a form tool can read and a label a person can", () => {
    expect(controls().length).toBeGreaterThan(8);
    const anonymous = controls()
      .filter((control) => accessibleName(control) === "" || (control.getAttribute("name") ?? control.id) === "")
      .map((control) => control.outerHTML);

    expect(anonymous).toEqual([]);
  });

  it("points each label at its own control instead of whatever is nested first", () => {
    expect(controlLabelled("Session title")?.getAttribute("name")).toBe("title");
    expect(controlLabelled("Track")?.tagName).toBe("SELECT");
    expect(controlLabelled("Capacity")?.getAttribute("name")).toBe("capacity");
    // The date picker puts a calendar button beside its input, so the label is
    // written to name the input rather than left to find it by position.
    const startsAt = controlLabelled("Starts at");
    expect(startsAt?.tagName).toBe("INPUT");
    expect(container.querySelector(`label[for="${CSS.escape(startsAt?.id ?? "")}"]`)).not.toBeNull();
  });

  it("does not hand the description's label to the editor's toolbar", () => {
    // A <label> cannot be associated with a contenteditable, so wrapping one
    // around the editor labelled its first labelable descendant — the Bold
    // button — and clicking the word "Description" toggled bold.
    expect(container.querySelector('[role="group"][aria-label="Description"]')).not.toBeNull();
    expect([...container.querySelectorAll("label")].some((label) => label.querySelector("[role='toolbar']"))).toBe(false);
    expect(container.querySelector('[role="textbox"]')?.getAttribute("aria-label")).toBe("Session description");
  });
});
