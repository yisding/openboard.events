import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("bulk reminder client adoption", () => {
  it.each([
    ["Files", "../portal/deliverables/components/files-admin-view.tsx", 'surface: "files"', "reminderRecovery.start(frozenTargets)"],
    ["Speakers", "../portal/components/speakers-admin/speakers-admin-view.tsx", 'surface: "speakers"', "reminderRecovery.start(flatTargets)"],
  ])("routes %s sends through the shared durable recovery controller", (_name, path, surface, call) => {
    const text = source(path);
    expect(text).toContain("useBulkReminderRecovery");
    expect(text).toContain(surface);
    expect(text).toContain(call);
    expect(text).toContain("onAcknowledged: clearReminderSelection");
    expect(text).toContain("getSelectionFingerprint:");
    expect(text).toContain("BULK_REMINDER_TARGET_LIMIT");
    expect(text).not.toContain("JSON.stringify({ targets:");
  });

  it("mounts task-matrix recovery at page scope while the drawer delegates its exact targets", () => {
    const page = source("../portal/tasks-admin/components/tasks-admin-view.tsx");
    const drawer = source("../portal/tasks-admin/components/task-matrix-drawer.tsx");
    expect(page).toContain("useBulkReminderRecovery");
    expect(page).toContain('surface: "task-matrix"');
    expect(page).toContain("onAcknowledged:");
    expect(page).toContain("<BulkReminderRecoveryDialog controller={reminderRecovery} />");
    expect(drawer).toContain("reminderRecovery.start(targets.map");
    expect(drawer).toContain("BULK_REMINDER_TARGET_LIMIT");
    expect(drawer).not.toContain("JSON.stringify({ targets:");
  });
});
