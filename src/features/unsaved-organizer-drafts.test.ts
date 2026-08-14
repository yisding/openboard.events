import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("unsaved organizer draft coverage", () => {
  it("guards CFP builder navigation and a half-written new question", () => {
    const builder = source("./forms/form-builder.tsx");
    expect(builder).toContain("const newQuestionDraftDirty = adding && (newLabel.trim().length > 0 || newType !== \"text\")");
    // An unconfirmed Participant save is unresolved work even when the local
    // editor revisions were clean at click time; navigation must not discard
    // its exact replay control.
    expect(builder).toContain("useUnsavedWorkGuard(hasUnsavedWork || participantStepRecovery !== null)");
    expect(builder).toContain("Participant save is unconfirmed");
    expect(builder).toContain("Confirm participant save");
    expect(builder).toContain("the same FormBuilder mounted");
    expect(builder).toContain("allowNextNavigation(() => {");
    expect(builder).toContain("router.push(destination, { scroll: false })");
    expect(builder).toContain("onClose={closeAddQuestion}");
    expect(builder).toContain("if (routingDraftDirty) runGuarded(performStep)");
    expect(builder).toContain("onDraftStateChange={onRoutingDraftStateChange}");
    const routing = source("./forms/components/builder/routing-rules-panel.tsx");
    expect(routing).toContain("useUnsavedWorkGuard(editorDirty)");
    expect(routing).toContain("function requestEditor(");
    expect(routing).toContain("onEdit={() => requestEditor(");
    expect(routing).toContain("onClick={() => requestEditor({ ruleId: null");
  });

  it("guards portal metadata, custom-question drafts, and field-modal edits", () => {
    const builder = source("./portal/form-builder/components/portal-form-builder.tsx");
    expect(builder).toContain("useUnsavedWorkGuard(dirty || customFieldDraftDirty)");
    expect(builder).toContain("onClose={closeCustomField}");
    expect(builder).toContain("useUnsavedWorkGuard(dirty)");
    expect(builder).toContain("requestGuardedEditorClose({ busy, dirty, runGuarded, close: onClose })");
    expect(builder.match(/mergePortalTopLevelDraft\(next, current\)/g)).toHaveLength(5);
    expect(builder).toContain("setDirty(false)");
  });

  it("guards template changes across templates, reloads, and communications tabs", () => {
    const templates = source("./comms/components/templates-tab.tsx");
    const shell = source("./comms/components/comms-admin-page.tsx");
    expect(templates).toContain("useUnsavedWorkGuard(dirty)");
    expect(templates).toContain("runGuarded(() => selectKey(row.key))");
    expect(templates).toContain("runGuarded(() => { void reload(); })");
    expect(templates).toContain("setDirty(false)");
    expect(shell).toContain("runGuarded(() => allowNextNavigation(() => {");
    expect(shell).toContain("router.replace(destination, { scroll: false })");
  });

  it("guards reminder ladder changes until a successful save", () => {
    const reminders = source("./comms/components/reminders-tab.tsx");
    expect(reminders).toContain("useUnsavedWorkGuard(dirty)");
    expect(reminders).toContain("await save.mutateAsync(rows)");
    expect(reminders).toContain("setDirty(false)");
  });

  it("guards reviewer assignment selections before closing the drawer", () => {
    const assignments = source("./submissions/evaluation/components/assignment-drawer.tsx");
    expect(assignments).toContain("useUnsavedWorkGuard(dirty)");
    expect(assignments).toContain("requestGuardedEditorClose({ busy, dirty, runGuarded, close: onClose })");
    expect(assignments).toContain("<Drawer open onClose={requestClose}");
    expect(assignments).toContain("onClick={requestClose}>Cancel</Button>");
  });

});
