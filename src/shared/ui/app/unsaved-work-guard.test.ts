import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shell unsaved-work guard wiring", () => {
  it("covers links, browser navigation, and document unloads", () => {
    const source = readFileSync(new URL("./unsaved-work-guard.tsx", import.meta.url), "utf8");

    expect(source).toContain('onClickCapture={captureLink}');
    expect(source).toContain('navigation.addEventListener("navigate", guardNavigation)');
    expect(source).toContain('globalThis.addEventListener("beforeunload", warnBeforeUnload)');
    expect(source).toContain("setPending((current) => current ?? { confirm: action");
    expect(source).toContain("allowNextRef.current = Boolean(action)");
  });

  it("guards sign-out before the authentication request and mounts at the event shell", () => {
    const signOut = readFileSync(new URL("../../../features/auth/components/sign-out-button.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../../../features/shell/admin-shell.tsx", import.meta.url), "utf8");

    expect(signOut).toContain('onClick={() => runGuarded(() => { void signOut(); })}');
    expect(signOut.indexOf("runGuarded")).toBeLessThan(signOut.indexOf('fetch(kind === "admin"'));
    expect(signOut).toContain("allowNextNavigation(() => {");
    expect(shell).toContain("<UnsavedWorkGuardProvider><div className=\"app-shell\">");
  });
});
