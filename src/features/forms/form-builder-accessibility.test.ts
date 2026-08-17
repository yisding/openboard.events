import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuilderForm } from "./builder-types";
import { ParticipantRoles, questionLabelList, visibilityDependents, withRequiredSpeakerRole } from "./form-builder";

Object.assign(globalThis, { React });

describe("form builder accessibility", () => {
  it("renders Speaker as fixed and required while secondary roles remain named switches", () => {
    const form = {
      participantRoles: [
        { role: "speaker", enabled: false },
        { role: "co_speaker", enabled: true },
        { role: "moderator", enabled: false },
      ],
    } as BuilderForm;
    const html = renderToStaticMarkup(React.createElement(ParticipantRoles, { form, onChange: () => undefined }));

    expect(html).toContain("The primary speaker is always required.");
    expect(html).not.toContain('aria-label="Allow speaker role"');
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Allow co-speaker role"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Allow moderator role"');
    expect(html).toContain('aria-checked="false"');
  });

  it("normalizes stale Speaker data to enabled before saving role changes", () => {
    expect(withRequiredSpeakerRole([
      { role: "speaker", enabled: false },
      { role: "co_speaker", enabled: false },
    ])).toEqual([
      { role: "speaker", enabled: true },
      { role: "co_speaker", enabled: false },
    ]);
  });

  it("keeps the inspector open unless confirmed deletion succeeds", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");
    expect(source).toContain("<ConfirmDialog");
    expect(source).toContain('title={pendingDelete ? `Delete “${pendingDelete.label}”?`');
    expect(source).toContain("if (deleted) {");
    expect(source).toContain("setSelected(null);");
    expect(source).toContain("setPendingDelete(null);");
  });

  it("keeps question selection and reorder controls from submitting the builder form", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");

    expect(source).toContain('<button type="button" className="field-row-main"');
    expect(source).toContain('<button type="button" className="icon-button" aria-label={`Move ${field.label} up`}');
    expect(source).toContain('<button type="button" className="icon-button" aria-label={`Move ${field.label} down`}');
  });

  // `.selected builder-field-row` is a border and a glow. Speech gets neither,
  // so without a state on the row's own button the question the inspector is
  // editing is indistinguishable from the twenty questions around it.
  it("says which question the inspector is editing, not only paints it", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");

    expect(source).toContain('className="field-row-main" aria-pressed={selected === field.id}');
  });

  it("keeps the full field editor reachable when the desktop inspector is hidden", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(source).toContain('window.matchMedia("(max-width: 1024px)")');
    expect(source).toContain('<aside className="builder-inspector">{selectedField ? <FieldInspector');
    expect(source).toContain('{compactInspector && selectedField && <Modal');
    expect(source).toContain('title={`Edit “${selectedField.label}”`}');
    expect(source).toContain('<div className="compact-field-inspector">');
    expect(source).toContain('onSave={() => void saveCompactField()}');
    expect(source).toContain('onDelete={() => setPendingDelete(selectedField)}');
    expect(source).toContain('if (await saveField(selectedField)) setSelected(null);');
    expect(css).toContain('@media(max-width:1024px)');
    expect(css).toContain('.builder-inspector{display:none}');
    expect(css).toContain('.compact-field-inspector .inspector-content>.form-stack{max-height:none;overflow:visible;padding:0}');
  });

  it("uses the persisted form window, not unsaved date edits, to gate public-link copying", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");

    expect(source).toContain("const [persistedAvailabilityInput, setPersistedAvailabilityInput]");
    expect(source).toContain("setPersistedAvailabilityInput({ status: next.status, opensAt: next.opensAt, closesAt: next.closesAt })");
    expect(source).toContain("formAvailability(persistedAvailabilityInput, availabilityNow)");
    expect(source).toContain("setAvailabilityNow(clickedAt)");
    expect(source).toContain('availability === "live" && <Button variant="secondary"');
    expect(source).toContain("Copy live link");
    expect(source).toContain('formAvailability(persistedAvailabilityInput, clickedAt) !== "live"');
    expect(source).toContain('href={`/events/${event.id}/forms/${form.id}/preview`}');
    expect(source).not.toContain("navigator.clipboard.writeText");
  });

  it("blocks stale-content publishing and confirms every availability change", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");
    const requestStart = source.indexOf("function requestAvailabilityChange()");
    const confirmStart = source.indexOf("async function confirmAvailabilityChange()");

    expect(source).toContain("const hasUnsavedBuilderTargets = hasUnsavedWork || routingDraftDirty || participantStepRecovery !== null");
    expect(source).toContain('action === "open" && hasUnsavedBuilderTargets');
    expect(source).toContain('availabilityAlert && hasUnsavedBuilderTargets && <div className="locked-banner" role="alert"');
    expect(source).toContain("onClick={requestAvailabilityChange}");
    expect(requestStart).toBeGreaterThan(0);
    expect(source.slice(requestStart, confirmStart)).not.toContain("patchForm(");
    expect(source.slice(confirmStart, source.indexOf("const section", confirmStart))).toContain("await availabilityPatch(");
    expect(source).toContain('variant={pendingAvailabilityAction === "open" ? "primary" : "destructive"}');
    expect(source).toContain("confirmDisabled={availabilityRecovery !== null || participantStepRecovery !== null}");
  });

  it("separates version publishing from form availability and removes the duplicate footer save", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(source).toContain('className="builder-edit-actions" role="group" aria-label="Form editing actions"');
    expect(source).toContain('aria-label="Copy live form link" title="Copy live form link"');
    expect(source).toContain('aria-label="Preview form" title="Preview form"');
    // The accessible name must start with the visible label ("Publish
    // version") per WCAG 2.5.3 label-in-name — the rest is the long-form
    // context, kept for narrow viewports where the visible label is hidden
    // (see `.builder-action-label{display:none}` below).
    expect(source).toContain('id="publish-form-version" aria-label="Publish version — publishes the current step as a new immutable form version"');
    expect(source).toContain('onClick={() => void saveStep()}');
    expect(source).toContain('className="builder-lifecycle-actions" role="group" aria-label="Form availability"');
    expect(source).toContain('<CircleStop size={16} />');
    expect(source).toContain("const availabilityActionLabel = formAvailabilityActionLabel(");
    expect(source).toContain("<span className=\"builder-action-label\">{availabilityActionLabel}</span>");
    expect(source).toContain('href="#publish-form-version"');
    expect(source).toContain("Every publish creates a new immutable version.");
    expect(source).not.toContain("Save step</Button>");
    expect(css).toContain(".builder-lifecycle-actions{padding-left:12px");
    const tabletRules = css.slice(css.indexOf("@media(max-width:1280px){.builder-title"), css.indexOf("@media(max-width:1024px){.cfp-welcome"));
    expect(tabletRules).toContain(".builder-action-label{display:none}");
    expect(tabletRules).toContain(".builder-edit-actions>.button,.builder-lifecycle-actions>.button{width:36px");
  });

  it("keeps a new-question draft open when its save fails", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");
    expect(source).toContain("const added = await run(");
    expect(source).toContain("if (!added) return;");
    expect(source.indexOf("if (!added) return;")).toBeLessThan(source.indexOf("setAdding(false);", source.indexOf("async function addField")));
  });

  it("turns the structural-lock notice into a guarded duplicate escape hatch", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");

    expect(source).toContain("A duplicate starts as a draft without submissions, routing rules, or opening and closing dates.");
    expect(source).toContain("duplicateFormAsDraft(event.id, form.id)");
    expect(source).toContain("runGuarded(() => { void duplicateAsDraft(); })");
    expect(source).toContain("Return to Submission forms and refresh before trying again.");
  });

  // The server refuses this delete with a compiler diagnostic naming field ids.
  // The confirmation has to say which question breaks, in its own words.
  it("names the questions whose visibility depends on the one being deleted", () => {
    const source = { sections: [{ fields: [
      { id: "f-1", label: "Session length", visibility: null },
      { id: "f-2", label: "Room preference", visibility: { match: "all", conditions: [{ sourceFieldId: "f-1", op: "eq", value: "90" }] } },
      { id: "f-3", label: "A/V needs", visibility: { match: "all", conditions: [{ sourceFieldId: "f-1", op: "answered" }] } },
    ] }] } as unknown as BuilderForm;

    expect(visibilityDependents(source, "f-1").map((field) => field.label)).toEqual(["Room preference", "A/V needs"]);
    expect(visibilityDependents(source, "f-2")).toEqual([]);
    expect(questionLabelList(visibilityDependents(source, "f-1"))).toBe("“Room preference” and “A/V needs”");
  });

  it("shows locked questions the system field they are bound to instead of hiding the mapping", () => {
    const source = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");

    expect(source).toContain("{(!field.locked || field.mapsTo) && <Field");
    expect(source).toContain("Locked to this system field, so this question can’t be remapped or removed.");
    expect(source).toContain("<option key={target} value={target}>{mapsToLabel(target)}</option>");
    expect(source).not.toContain("<option key={target} value={target}>{target}</option>");
  });
});
