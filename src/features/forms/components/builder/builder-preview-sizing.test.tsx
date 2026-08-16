import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fieldIdSchema, formIdSchema, formSnapshotSchema, sectionIdSchema } from "@/shared/contracts";
import { BuilderPreview } from "./builder-preview";

Object.assign(globalThis, { React });

const snapshot = formSnapshotSchema.parse({
  formId: formIdSchema.parse("30000000-0000-4000-8000-000000000001"),
  version: 1,
  context: "cfp",
  sections: [{
    id: sectionIdSchema.parse("20000000-0000-4000-8000-000000000001"),
    key: "abstract",
    title: "Your proposal",
    pageHeading: "Your proposal",
    descriptionHtml: "",
    fields: [{
      id: fieldIdSchema.parse("40000000-0000-4000-8000-000000000001"),
      key: "session_length",
      label: "Session length",
      type: "dropdown",
      required: true,
      locked: false,
      maxChars: null,
      helpText: "",
      options: [{ id: "short", label: "25 minutes" }, { id: "long", label: "45 minutes" }],
      visibility: null,
      mapsTo: null,
    }],
  }],
});

const CSS = readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8");

describe("builder live preview sizing", () => {
  it("gives a preview dropdown a row of its own so it cannot clip its placeholder", () => {
    const html = renderToStaticMarkup(<BuilderPreview snapshot={snapshot} />);

    // The preview renders inside `.builder-inspector`, a `minmax(260px,1fr)`
    // rail. Two `.form-grid` columns inside it are 98px each, which cut
    // "Choose one" down to "Choo". The markup has to keep the seam the rule
    // below targets: the renderer's grid, inside the preview body.
    expect(html).toContain('class="builder-live-preview__body"');
    expect(html).toContain('class="form-grid"');
    expect(html).toContain(">Choose one</option>");

    expect(CSS).toContain(".builder-live-preview__body .form-grid{grid-template-columns:minmax(0,1fr)}");
  });
});
