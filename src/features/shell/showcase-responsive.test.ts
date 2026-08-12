import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("standalone component gallery spacing", () => {
  it("gives both gallery pages an application-width content wrapper", () => {
    expect(read("./kitchen-sink.tsx")).toContain('className="page showcase-page"');
    expect(read("./rich-primitives.tsx")).toContain('className="page showcase-page"');

    const css = read("../../app/globals.css");
    expect(css).toContain(".showcase-page { width: min(1510px, 100%); margin: 0 auto; padding: 32px; }");
    expect(css).toContain(".app-content, .showcase-page { padding: 24px 16px 32px; }");
  });
});
