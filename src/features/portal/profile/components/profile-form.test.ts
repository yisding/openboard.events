import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeakerProfileDTO } from "@/features/portal";
import { patchProfile, profileTextChanged, profileTextDraft } from "./profile-form";

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
  jobTitle: null,
  company: null,
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

  it("exits impersonation from a button, so no link gesture can skip the sign-out", () => {
    const banner = readFileSync(new URL("../../../auth/components/impersonation-banner.tsx", import.meta.url), "utf8");

    expect(banner).toContain('<button type="button"');
    // An anchor would let cmd/middle-click reach the admin URL with the
    // impersonated portal session still live.
    expect(banner).not.toContain("<Link");
    expect(banner).toContain("runGuarded(");
    expect(banner).toContain("window.location.assign(backHref)");
  });

  it("ends the impersonated portal session before returning to admin", () => {
    const banner = readFileSync(new URL("../../../auth/components/impersonation-banner.tsx", import.meta.url), "utf8");

    expect(banner).toContain('fetch("/api/internal/auth/portal/logout"');
    // The return navigation only happens once the session row is gone.
    expect(banner.indexOf("if (!response.ok)")).toBeLessThan(banner.indexOf("window.location.assign(backHref)"));
  });
});

describe("patchProfile error reading", () => {
  const payload = { firstName: "Ada" } as Parameters<typeof patchProfile>[1];

  function respond(body: unknown, status = 400) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })));
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads field errors from where the envelope actually puts them", async () => {
    // `errorEnvelope` puts a zod failure's `fieldErrors` at the *top level* of
    // `error`; `data` is `AppError.details`, a different constructor argument.
    // Reading `error.data.fieldErrors` therefore never found anything, so
    // `setFieldErrors` only ever received nothing and all eight
    // `error={fieldErrors.*}` slots — plus the focus-first-invalid effect —
    // were dead. A speaker over a field's limit got a bare "Request validation
    // failed" toast with nothing highlighted, across twelve inputs.
    respond({ error: { code: "VALIDATION", message: "Request validation failed", fieldErrors: { company: "Too long" } } });
    await expect(patchProfile("evt", payload)).resolves.toMatchObject({
      ok: false,
      fieldErrors: { company: "Too long" },
    });
  });

  it("still reads the nested shape an AppError's details can carry", async () => {
    respond({ error: { code: "VALIDATION", message: "Nope", data: { fieldErrors: { headshotFileId: "Pick a smaller image" } } } });
    await expect(patchProfile("evt", payload)).resolves.toMatchObject({
      fieldErrors: { headshotFileId: "Pick a smaller image" },
    });
  });

  it("reports the message alone when there are no field errors", async () => {
    respond({ error: { code: "INTERNAL", message: "Unexpected server error" } });
    const result = await patchProfile("evt", payload);
    expect(result).toEqual({ ok: false, message: "Unexpected server error" });
  });
});
