import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("feature switch semantics", () => {
  it("routes audited custom switches through the named shared Switch", () => {
    const audited = [
      source("./forms-page.tsx"),
      source("./components/builder/settings-step.tsx"),
      source("./components/builder/success-page-card.tsx"),
      source("./components/builder/routing-rules-panel.tsx"),
      source("../portal/tasks-admin/components/task-editor.tsx"),
      source("../public/embeds-admin-page.tsx"),
    ];

    for (const file of audited) {
      expect(file).toContain("<Switch");
      expect(file).not.toContain('className={`switch');
    }
  });

  it("gives each repeated embed switch a content-specific name", () => {
    const embeds = source("../public/embeds-admin-page.tsx");
    expect(embeds).toContain("label={`${meta.label} embed`}");
    expect(embeds).toContain("label={`${meta.label}: show event header`}");
    expect(embeds).toContain("label={`${meta.label}: show description`}");
    expect(embeds).toContain("label={`${meta.label}: show company`}");
    expect(embeds).toContain("label={`${meta.label}: show bio`}");
  });
});
