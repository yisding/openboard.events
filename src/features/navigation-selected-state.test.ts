import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("organizer navigation selected state", () => {
  it("exposes in-place settings and task filters as pressed", () => {
    const settings = source("./events/components/settings-shell.tsx");
    const tasks = source("./portal/tasks-admin/components/tasks-admin-view.tsx");

    expect(settings).toContain('aria-label="Event settings sections"');
    expect(settings).toContain("aria-pressed={tab === id}");
    expect(tasks).toContain('aria-label="Task filters"');
    expect(tasks.match(/aria-pressed=\{tab ===/g)).toHaveLength(4);
  });

  it("marks current CRM and dashboard links", () => {
    const crm = source("./crm/components/crm-nav.tsx");
    const dashboard = source("./dashboard/components/DashboardTabs.tsx");

    expect(crm.match(/aria-current=/g)).toHaveLength(3);
    expect(dashboard.match(/aria-current=/g)).toHaveLength(2);
  });
});
