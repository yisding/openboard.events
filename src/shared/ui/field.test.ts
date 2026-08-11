import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, ProgressBar, Segmented, Switch } from "./ui-kit";

Object.assign(globalThis, { React });

/**
 * `<button>` is a labelable element, so a `<label>` wrapping a grid of choice
 * buttons labels the first one — and HTML-AAM then names that button after
 * every *other* option's text. On the form builder's "Add a question" dialog
 * that made the first response type answer to "Dropdown" and the Dropdown card
 * answer to nothing, which no organizer using a screen reader could work with
 * and which a role-based query cannot disambiguate. `group` is the opt-out for
 * fields whose control is a set rather than a single input.
 */
describe("Field", () => {
  const grid = () => React.createElement("div", { className: "type-grid" }, [
    React.createElement("button", { key: "a" }, "Short text"),
    React.createElement("button", { key: "b" }, "Dropdown"),
  ]);

  it("wraps a single input in a label, so clicking the label still focuses it", () => {
    const html = renderToStaticMarkup(React.createElement(Field, { label: "Question label", required: true }, React.createElement("input", {})));
    expect(html).toContain("<label");
    expect(html).toContain("Question label");
  });

  it("renders a named group instead of a label when the control is a set of buttons", () => {
    const html = renderToStaticMarkup(React.createElement(Field, { label: "Response type", group: true }, grid()));
    expect(html).not.toContain("<label");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Response type"');
    // Same class, so the group carries the field's styling unchanged.
    expect(html).toContain('class="field"');
  });

  it("keeps the invalid class and the alerting error in group mode", () => {
    const html = renderToStaticMarkup(React.createElement(Field, { label: "Response type", group: true, radioGroup: true, error: "Pick one", errorId: "response-type-error" }, grid()));
    expect(html).toContain("field field-invalid");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="response-type-error"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Pick one");
  });

  it("gives callers stable ids for associated help and errors", () => {
    const help = renderToStaticMarkup(React.createElement(Field, { label: "Biography", hint: "500 characters", hintId: "bio-help" }, React.createElement("textarea", { "aria-describedby": "bio-help" })));
    const error = renderToStaticMarkup(React.createElement(Field, { label: "Biography", error: "Too long", errorId: "bio-error" }, React.createElement("textarea", { "aria-describedby": "bio-error", "aria-invalid": true })));
    expect(help).toContain('id="bio-help"');
    expect(help).toContain('aria-describedby="bio-help"');
    expect(error).toContain('id="bio-error"');
    expect(error).toContain('aria-describedby="bio-error"');
    expect(error).toContain('aria-invalid="true"');
  });
});

describe("stateful button controls", () => {
  it("gives a switch its name and checked state", () => {
    const html = renderToStaticMarkup(React.createElement(Switch, { label: "Send confirmation", checked: true }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Send confirmation"');
    expect(html).toContain('aria-checked="true"');
  });

  it("names progress and exposes a clamped numeric value", () => {
    const html = renderToStaticMarkup(React.createElement(ProgressBar, { label: "Speaker readiness", value: 120 }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Speaker readiness"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="100"');
  });

  it("exposes the selected Segmented button", () => {
    const html = renderToStaticMarkup(React.createElement(Segmented, {
      label: "Task content type",
      value: "tasks",
      onChange: () => undefined,
      items: [{ value: "tasks", label: "Tasks" }, { value: "files", label: "Files" }],
    }));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Task content type"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });
});
