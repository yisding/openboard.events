import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SpeakerProfileDTO } from "@/features/portal";
import { profileTextChanged, profileTextDraft } from "./profile-form";

const profile = {
  firstName: "Ada",
  lastName: "Lovelace",
  bioHtml: null,
  salutation: null,
  honorific: null,
  pronouns: null,
  gender: null,
  linkedinUrl: null,
  twitterUrl: null,
  facebookUrl: null,
  websiteUrl: null,
} as SpeakerProfileDTO;

describe("speaker profile unsaved-work guard", () => {
  it("normalizes nullable profile fields before dirty comparison", () => {
    const baseline = profileTextDraft(profile);

    expect(baseline.bioHtml).toBe("");
    expect(baseline.linkedinUrl).toBe("");
    expect(profileTextChanged({ ...baseline }, baseline)).toBe(false);
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

    expect(shell).toContain("<UnsavedWorkGuardProvider><div className=\"portal-shell\">");
    expect(shell.indexOf("<UnsavedWorkGuardProvider>")).toBeLessThan(shell.indexOf("<SignOutButton"));
    expect(shell).toContain("const open=openPath===pathname");
  });

  it("guards the credential-free demo profile and browser-history fallback", () => {
    const demo = readFileSync(new URL("../../portal-profile.tsx", import.meta.url), "utf8");
    const guard = readFileSync(new URL("../../../../shared/ui/app/unsaved-work-guard.tsx", import.meta.url), "utf8");

    expect(demo).toContain("useUnsavedWorkGuard(JSON.stringify(currentText) !== JSON.stringify(savedText))");
    expect(demo).toContain("setSavedText(currentText)");
    expect(guard).toContain('globalThis.addEventListener("popstate", guardHistory, { capture: true })');
    expect(guard).toContain("window.history.replaceState(markerState");
    expect(guard).toContain("window.history.pushState(activeState");
    expect(guard).toContain("window.history.replaceState(previousState");
    expect(guard).toContain("fallback.leave(action)");
    expect(guard).toContain("event.stopImmediatePropagation()");
    expect(guard).toContain("restorationForwardSteps - 1");
    expect(guard).toContain("window.history.go(-backSteps)");
    const banner = readFileSync(new URL("../../../auth/components/impersonation-banner.tsx", import.meta.url), "utf8");
    expect(banner).toContain("data-unsaved-guard-owned");
    expect(banner).toContain("onExit?.()");
  });
});
