import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TaskEditor validation accessibility", () => {
  it("renders field errors with associations and focuses the first invalid control", () => {
    const source = readFileSync(new URL("./task-editor.tsx", import.meta.url), "utf8");

    expect(source).toContain("error={fieldErrors.name}");
    expect(source).toContain('errorId="task-name-error"');
    expect(source).toContain('aria-describedby={fieldErrors.name ? "task-name-error" : undefined}');
    expect(source).toContain("error={fieldErrors.completionMode}");
    expect(source).toContain("querySelector<HTMLElement>('[aria-invalid=\"true\"]')?.focus()");
  });
});
