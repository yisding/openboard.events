import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SpeakerProfileDTO } from "@/features/portal";
import { profileTextChanged, profileTextDraft } from "./profile-form";

const profile: SpeakerProfileDTO = {
  contactId: "contact_1",
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  bioHtml: null,
  salutation: null,
  honorific: null,
  pronouns: null,
  gender: null,
  headshotFileId: null,
  headshotUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
  facebookUrl: null,
  websiteUrl: null,
};

describe("speaker profile unsaved-work guard", () => {
  it("normalizes nullable profile fields before dirty comparison", () => {
    const baseline = profileTextDraft(profile);

    expect(baseline.bioHtml).toBe("");
    expect(baseline.linkedinUrl).toBe("");
    expect(profileTextChanged({ ...baseline }, baseline)).toBe(false);
    const { firstName, ...rest } = baseline;
    expect(profileTextChanged({ ...rest, firstName }, baseline)).toBe(false);
    expect(profileTextChanged({ ...baseline, firstName: "Augusta" }, baseline)).toBe(true);
  });

  it("registers text edits and advances the saved baseline only after success", () => {
    const source = readFileSync(new URL("./profile-form.tsx", import.meta.url), "utf8");

    expect(source).toContain("useUnsavedWorkGuard(dirty)");
    expect(source.indexOf("if (!result.ok)")).toBeLessThan(source.indexOf("setSavedText(submittedText)"));
    expect(source.indexOf("setSavedText(submittedText)")).toBeLessThan(source.indexOf('toast("Saved successfully.")'));
    expect(source.indexOf("setSavedText(submittedText)")).toBeLessThan(source.indexOf("router.refresh()"));
    expect(source.slice(source.indexOf("async function onHeadshotUploaded"))).not.toContain("setSavedText");
  });

  it("mounts the shared guard around portal navigation and sign-out", () => {
    const shell = readFileSync(new URL("../../portal-shell.tsx", import.meta.url), "utf8");

    expect(shell).toContain("<UnsavedWorkGuardProvider>");
    expect(shell).toContain('<div className="portal-shell">');
    expect(shell.indexOf("<UnsavedWorkGuardProvider>")).toBeLessThan(shell.indexOf("<SignOutButton"));
    expect(shell).toContain("const open = openPath === pathname");
  });

  it("guards browser-history traversal without probing adjacent entries", () => {
    const guard = readFileSync(new URL("../../../../shared/ui/app/unsaved-work-guard.tsx", import.meta.url), "utf8");

    expect(guard).toContain('globalThis.addEventListener("popstate", guardHistory, { capture: true })');
    expect(guard).toContain("window.history.replaceState(markerState");
    expect(guard).not.toContain("window.history.pushState");
    expect(guard).toContain("window.history.replaceState(previousState");
    expect(guard).toContain("fallback.leave(action)");
    expect(guard).toContain("event.stopImmediatePropagation()");
    expect(guard).toContain("const delta = historyTraversalDelta(markerState, event.state)");
    expect(guard).toContain("window.history.go(-delta)");
    expect(guard).toContain("window.history.go(returned.delta)");
    expect(guard).not.toContain("restorationDirection");
  });

  it("guards the owned impersonation return without breaking modified clicks", () => {
    const banner = readFileSync(new URL("../../../auth/components/impersonation-banner.tsx", import.meta.url), "utf8");

    expect(banner).toContain("data-unsaved-guard-owned");
    expect(banner).toContain("event.metaKey || event.ctrlKey");
    expect(banner).toContain("router.push(backHref)");
  });
});
