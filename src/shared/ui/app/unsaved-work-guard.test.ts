import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { holdHistoryTraversal, isSameNavigationDestination, shouldInterceptNavigation } from "./unsaved-work-guard";

describe("shell unsaved-work guard wiring", () => {
  it("covers links, browser navigation, and document unloads", () => {
    const source = readFileSync(new URL("./unsaved-work-guard.tsx", import.meta.url), "utf8");

    expect(source).toContain('onClickCapture={captureLink}');
    expect(source).toContain('navigation.addEventListener("navigate", guardNavigation)');
    expect(source).toContain('globalThis.addEventListener("beforeunload", warnBeforeUnload)');
    expect(source).toContain("setPending((current) => current ?? { confirm: action");
    expect(source).toContain("allowNextRef.current = Boolean(action)");
    expect(source).toContain("if (allowNextUnloadRef.current)");
    const sameDestination = source.indexOf("isSameNavigationDestination(options.destination, window.location.href)");
    expect(sameDestination).toBeGreaterThan(-1);
    expect(sameDestination).toBeLessThan(source.indexOf("const fallback = historyFallbackRef.current"));
    expect(source).toContain("if (!shouldInterceptNavigation(event)) return;");
  });

  it("keeps same-document actions guarded and leaves reloads to beforeunload", () => {
    expect(isSameNavigationDestination("/events/one/review", "https://openboard.events/events/one/review")).toBe(true);
    expect(isSameNavigationDestination("?planId=two", "https://openboard.events/events/one/review?planId=two")).toBe(true);
    expect(isSameNavigationDestination("?planId=three", "https://openboard.events/events/one/review?planId=two")).toBe(false);

    const navigation = { canIntercept: true, destination: { sameDocument: true }, downloadRequest: null, hashChange: false };
    expect(shouldInterceptNavigation({ ...navigation, navigationType: "push" })).toBe(true);
    expect(shouldInterceptNavigation({ ...navigation, navigationType: "reload" })).toBe(false);
    expect(shouldInterceptNavigation({ ...navigation, destination: { sameDocument: false }, navigationType: "push" })).toBe(false);
  });

  it("holds a history target in place and restores it only on confirmation", async () => {
    const replaceState = vi.fn();
    const replay = vi.fn();
    const targetState = { __NA: true, page: "target" };
    const decision = holdHistoryTraversal(
      { replaceState },
      "https://openboard.events/current",
      { __NA: true, guarded: true },
      "https://openboard.events/target",
      targetState,
      replay,
    );

    expect(replaceState).toHaveBeenCalledOnce();
    decision.cancel();
    expect(replaceState).toHaveBeenCalledOnce();
    await decision.confirm();
    expect(replaceState).toHaveBeenLastCalledWith(targetState, "", "https://openboard.events/target");
    expect(replay).toHaveBeenCalledWith(targetState);
  });

  it("guards sign-out before the authentication request and mounts at the event shell", () => {
    const signOut = readFileSync(new URL("../../../features/auth/components/sign-out-button.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../../../features/shell/admin-shell.tsx", import.meta.url), "utf8");

    expect(signOut).toContain('onClick={() => runGuarded(() => { void signOut(); })}');
    expect(signOut.indexOf("runGuarded")).toBeLessThan(signOut.indexOf('fetch(kind === "admin"'));
    expect(signOut).toContain("allowNextNavigation(() => {");
    expect(signOut).toContain("{ hardUnload: true }");
    expect(shell).toContain("<UnsavedWorkGuardProvider><div className=\"app-shell\">");
  });
});
