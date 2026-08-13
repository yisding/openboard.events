import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("communications organizer feedback", () => {
  it.each([
    ["send reminder", "./send-reminder-dialog.tsx", 'toast("Could not queue that reminder", { kind: "error" })'],
    ["save template", "./templates-tab.tsx", 'toast("Could not save that template", { kind: "error" })'],
    ["save reminder ladder", "./reminders-tab.tsx", 'toast("Could not save the reminder ladder", { kind: "error" })'],
    ["reinstate address", "./suppressions-tab.tsx", 'toast("Could not reinstate this address", { kind: "error" })'],
    ["retry failed messages", "./comms-log-table.tsx", 'toast("Could not confirm those retries — activity is refreshing, and retrying again is safe", { kind: "error" })'],
  ])("marks a failed %s action as an error", (_label, path, expected) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toContain(expected);
  });
});
