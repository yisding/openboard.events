import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import {
  CFP_PORTAL_REDIRECT_MS,
  CfpStaleRecovery,
  CfpSubmitFailureNotice,
  beginCfpSubmit,
  cfpRequest,
  cfpFlowSteps,
  cfpStepHeading,
  cfpSubmitFailure,
  focusCfpAccountControl,
  hasIncompleteParticipantEmail,
  participantEmail,
  participantFieldIds,
  preserveStaleCfpFailure,
  reloadUpdatedCfpForm,
  requiresCfpFormReload,
  settleCfpSubmitFailure,
  skippedCfpAutosaveResult,
  stepFieldErrors,
  schedulePortalRedirect,
  saveWithRetry,
  serializeAutosaves,
  stepForErrors,
  type AutosaveState,
} from "./components/cfp-steps";

Object.assign(globalThis, { React });
afterEach(() => vi.unstubAllGlobals());

const fieldId = (key: string) => {
  const field = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Missing field ${key}`);
  return field.id;
};

describe("CFP validation routing", () => {
  it("moves focus into and back out of the verification-code substep", () => {
    const focusEmail = vi.fn();
    const focusCode = vi.fn();
    focusCfpAccountControl(true, { focus: focusEmail }, { focus: focusCode });
    expect(focusCode).toHaveBeenCalledOnce();
    expect(focusEmail).not.toHaveBeenCalled();

    focusCfpAccountControl(false, { focus: focusEmail }, { focus: focusCode });
    expect(focusEmail).toHaveBeenCalledOnce();
  });

  it("omits the speaker step when participant collection is disabled", () => {
    expect(cfpFlowSteps(false)).toEqual(["account", "submission", "review"]);
    expect(cfpFlowSteps(true)).toContain("speaker");
  });

  it("returns participant errors to the speaker step", () => {
    expect(stepForErrors(GOLDEN_SNAPSHOT, { [fieldId("first_name")]: "First name is required" })).toBe("speaker");
    expect(stepForErrors(GOLDEN_SNAPSHOT, {
      [`participant:panelist-1:${fieldId("first_name")}`]: "First name is required",
    })).toBe("speaker");
  });

  it("returns abstract errors to the submission step", () => {
    expect(stepForErrors(GOLDEN_SNAPSHOT, { [fieldId("title")]: "Title is required" })).toBe("submission");
  });

  it("keeps co-speaker answers scoped to participant fields", () => {
    const ids = participantFieldIds(GOLDEN_SNAPSHOT);
    expect(ids.has(fieldId("first_name"))).toBe(true);
    expect(ids.has(fieldId("title"))).toBe(false);
    expect(participantEmail(GOLDEN_SNAPSHOT, { [fieldId("email")]: { t: "s", v: "  CO@EXAMPLE.COM " } })).toBe("co@example.com");
  });

  it("does not treat a co-speaker without an email as autosaveable", () => {
    expect(hasIncompleteParticipantEmail(GOLDEN_SNAPSHOT, [{ clientId: "co-1", role: "co_speaker", answers: {} }])).toBe(true);
    expect(hasIncompleteParticipantEmail(GOLDEN_SNAPSHOT, [{
      clientId: "co-1",
      role: "co_speaker",
      answers: { [fieldId("email")]: { t: "s", v: "co@example.com" } },
    }])).toBe(false);
  });

  it("blocks an empty required field before leaving its step", () => {
    expect(stepFieldErrors(GOLDEN_SNAPSHOT, ["abstract"], {})).toMatchObject({
      [fieldId("title")]: expect.stringContaining("required"),
    });
    expect(stepFieldErrors(GOLDEN_SNAPSHOT, ["abstract"], {
      [fieldId("title")]: { t: "s", v: "An accessible proposal" },
    })[fieldId("title")]).toBeUndefined();
  });

  it("blocks rich text over the visible-text limit at its own step", () => {
    const over = stepFieldErrors(GOLDEN_SNAPSHOT, ["abstract"], {
      [fieldId("description")]: { t: "s", v: `<p>${"x".repeat(5001)}</p>` },
    });
    expect(over[fieldId("description")]).toBe("Keep this under 5000 characters");

    const boundary = stepFieldErrors(GOLDEN_SNAPSHOT, ["abstract"], {
      [fieldId("description")]: { t: "s", v: `<p><strong>${"x".repeat(5000)}</strong></p>` },
    });
    expect(boundary[fieldId("description")]).toBeUndefined();
  });

  it("counts rich-text content instead of its HTML markup", () => {
    const markup = `<p>${Array.from({ length: 500 }, () => "<strong>word</strong>").join("")}</p>`;
    expect(markup.length).toBeGreaterThan(5000);
    expect(stepFieldErrors(GOLDEN_SNAPSHOT, ["abstract"], {
      [fieldId("description")]: { t: "s", v: markup },
    })[fieldId("description")]).toBeUndefined();
  });

  it("uses the server fallback limit and ignores overlong hidden answers", () => {
    expect(stepFieldErrors(GOLDEN_SNAPSHOT, ["participant"], {
      [fieldId("company")]: { t: "s", v: "x".repeat(501) },
    })[fieldId("company")]).toBe("Keep this under 500 characters");

    const conditional = structuredClone(GOLDEN_SNAPSHOT);
    const workshopDuration = conditional.sections.flatMap((section) => section.fields)
      .find((field) => field.id === fieldId("workshop_duration"));
    if (!workshopDuration) throw new Error("Missing workshop duration field");
    workshopDuration.maxChars = 5;
    expect(stepFieldErrors(conditional, ["abstract"], {
      [fieldId("format")]: { t: "opt", v: "talk" },
      [fieldId("workshop_duration")]: { t: "s", v: "all-day workshop" },
    })[fieldId("workshop_duration")]).toBeUndefined();
  });

  it("uses the organizer-configured heading for each form step", () => {
    expect(cfpStepHeading(GOLDEN_SNAPSHOT, "submission")).toBe(GOLDEN_SNAPSHOT.sections.find((section) => section.key === "abstract")?.pageHeading);
    expect(cfpStepHeading(GOLDEN_SNAPSHOT, "review")).toBe("Review your proposal");
  });
});

describe("CFP success redirect", () => {
  it("redirects after ten seconds and cancels the pending timer on cleanup", () => {
    let scheduled: (() => void) | undefined;
    const navigate = vi.fn();
    const schedule = vi.fn((callback: () => void) => {
      scheduled = callback;
      return 42;
    });
    const cancel = vi.fn();

    const cleanup = schedulePortalRedirect(true, navigate, schedule, cancel);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), CFP_PORTAL_REDIRECT_MS);
    scheduled?.();
    expect(navigate).toHaveBeenCalledOnce();
    cleanup();
    expect(cancel).toHaveBeenCalledWith(42);
  });

  it("does not schedule a redirect when the form setting is off", () => {
    const schedule = vi.fn(() => 1);
    schedulePortalRedirect(false, vi.fn(), schedule, vi.fn())();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("CFP stale form recovery", () => {
  it("preserves the server error code and fresh snapshot data", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: {
        code: "FORM_VERSION_STALE",
        message: "This form changed while you were filling it in",
        data: { snapshot: GOLDEN_SNAPSHOT, version: GOLDEN_SNAPSHOT.version },
      },
    }, { status: 409 })));

    await expect(cfpRequest("/api/internal/forms/form-1/submit", {})).resolves.toMatchObject({
      ok: false,
      code: "FORM_VERSION_STALE",
      errorData: { snapshot: GOLDEN_SNAPSHOT, version: GOLDEN_SNAPSHOT.version },
      retryable: false,
    });
  });

  it("renders stale recovery as a read-only screen with reload as its only action", () => {
    const stale = cfpSubmitFailure({
      ok: false,
      data: {},
      code: "FORM_VERSION_STALE",
      message: "This form changed while you were filling it in",
    });
    const staleHtml = renderToStaticMarkup(React.createElement(CfpStaleRecovery, { failure: stale, onReload: () => undefined }));

    expect(staleHtml).toContain("The organizer updated this form");
    expect(staleHtml).toContain("your saved draft will be restored");
    expect(staleHtml).toContain("Reload updated form");
    expect(staleHtml.match(/<button/g)).toHaveLength(1);
    expect(staleHtml).not.toContain("<form");
    expect(staleHtml).not.toContain("<input");
    expect(staleHtml).not.toContain("<textarea");
    expect(staleHtml).not.toContain("Back");
    expect(staleHtml).not.toContain("Submit proposal");
    expect(staleHtml).not.toContain("Retry now");
  });

  it("keeps stale recovery locked through notice and step-navigation clears", () => {
    const stale = cfpSubmitFailure({
      ok: false,
      data: {},
      code: "FORM_VERSION_STALE",
      message: "This form changed while you were filling it in",
    });
    const ordinary = cfpSubmitFailure({ ok: false, data: {}, message: "Could not submit proposal" });
    const ordinaryHtml = renderToStaticMarkup(React.createElement(CfpSubmitFailureNotice, { failure: ordinary }));

    expect(preserveStaleCfpFailure(stale)).toBe(stale);
    expect(preserveStaleCfpFailure(ordinary)).toBeNull();
    expect(requiresCfpFormReload(stale)).toBe(true);
    expect(ordinaryHtml).toContain("Could not submit proposal");
    expect(ordinaryHtml).not.toContain("Reload updated form");
    expect(requiresCfpFormReload(ordinary)).toBe(false);
  });

  it("cannot submit the obsolete snapshot again after a stale rejection", () => {
    const lock = { submitting: false, versionStale: false };
    const stale = cfpSubmitFailure({ ok: false, data: {}, code: "FORM_VERSION_STALE", message: "Form changed" });

    expect(beginCfpSubmit(lock)).toBe(true);
    settleCfpSubmitFailure(lock, stale);
    expect(lock).toEqual({ submitting: false, versionStale: true });
    expect(beginCfpSubmit(lock)).toBe(false);
  });

  it("marks a skipped post-stale autosave unsaved, never saved", () => {
    const states: AutosaveState[] = [];
    const skipped = skippedCfpAutosaveResult(
      { submitting: false, versionStale: true },
      (state) => states.push(state),
    );

    expect(skipped).toBe(false);
    expect(states).toEqual(["failed"]);
    expect(states).not.toContain("saved");
  });

  it("keeps ordinary submit failures retryable", () => {
    const lock = { submitting: false, versionStale: false };
    const ordinary = cfpSubmitFailure({ ok: false, data: {}, message: "Could not submit proposal" });

    expect(beginCfpSubmit(lock)).toBe(true);
    settleCfpSubmitFailure(lock, ordinary);
    expect(beginCfpSubmit(lock)).toBe(true);
  });

  it("runs the page-reload recovery action", () => {
    const reload = vi.fn();
    reloadUpdatedCfpForm(reload);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("CFP autosave", () => {
  it("retries transient failures with backoff", async () => {
    const states: AutosaveState[] = [];
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, data: {}, message: "offline", retryable: true })
      .mockResolvedValueOnce({ ok: false, data: {}, message: "busy", retryable: true })
      .mockResolvedValueOnce({ ok: true, data: {}, message: "" });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(saveWithRetry(save, (state) => states.push(state), wait)).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500]);
    expect(states).toEqual(["saving", "retrying", "retrying", "saved"]);
  });

  it("exposes a failed state after bounded retries", async () => {
    const states: AutosaveState[] = [];
    const save = vi.fn().mockResolvedValue({ ok: false, data: {}, message: "offline", retryable: true });

    await expect(saveWithRetry(save, (state) => states.push(state), async () => undefined)).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe("failed");
  });

  it("serializes snapshots so an older request always finishes first", async () => {
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const queued = serializeAutosaves(async (snapshot: number) => {
      started.push(snapshot);
      await new Promise<void>((resolve) => releases.push(resolve));
      return true;
    });

    const first = queued(1);
    const second = queued(2);
    await Promise.resolve();
    expect(started).toEqual([1]);
    releases.shift()?.();
    await first;
    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    releases.shift()?.();
    await second;
  });
});
