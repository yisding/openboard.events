import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("authentication transition focus", () => {
  it("focuses the portal code step heading after replacing the email form", () => {
    const source = readFileSync(new URL("./portal-login-form.tsx", import.meta.url), "utf8");

    expect(source).toContain("requestedHeadingRef.current?.focus()");
    expect(source).toContain('<h1 ref={requestedHeadingRef} tabIndex={-1}>Check your inbox</h1>');
    expect(source).toContain("<input autoFocus name=\"email\"");
  });

  it("focuses the password-reset confirmation heading", () => {
    const source = readFileSync(new URL("./forgot-password-form.tsx", import.meta.url), "utf8");

    expect(source).toContain("sentHeadingRef.current?.focus()");
    expect(source).toContain('<h1 ref={sentHeadingRef} tabIndex={-1}>Check your email</h1>');
  });
});
