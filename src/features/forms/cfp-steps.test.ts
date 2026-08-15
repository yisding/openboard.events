import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import {
  CFP_PORTAL_REDIRECT_MS,
  CFP_REQUEST_TIMEOUT_MS,
  CfpStaleRecovery,
  CfpSubmitFailureNotice,
  abortCfpSubmit,
  beginCfpSubmit,
  cfpAutosaveDisposition,
  cfpCodeRequestRecovery,
  cfpRequest,
  cfpFlowSteps,
  cfpProgressLabel,
  cfpStaleRecoveryState,
  cfpStepHeading,
  cfpSubmitFailure,
  createDeferredCfpAutosave,
  focusCfpAccountControl,
  hasIncompleteParticipantEmail,
  participantEmail,
  participantFieldIds,
  preserveStaleCfpFailure,
  reloadUpdatedCfpForm,
  requiresCfpFormReload,
  saveCfpDraftWithRecovery,
  scheduleCfpRecoveryFocus,
  settleCfpSubmitFailure,
  settleCfpSubmitSuccess,
  abstractAnswersOnly,
  stepFieldErrors,
  schedulePortalRedirect,
  saveWithRetry,
  serializeAutosaves,
  stepForErrors,
  type AutosaveState,
} from "./components/cfp-steps";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it("uses concise, customer-facing progress labels", () => {
    expect(cfpFlowSteps(true).map(cfpProgressLabel)).toEqual(["Account", "Submission", "Speaker", "Review"]);
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

  it("evaluates a co-speaker's conditional questions without the primary's answers", () => {
    // The server builds a participant's visibility context from the abstract
    // answers plus that participant's own (`submit.ts`'s `abstractContext`).
    // Handing a co-speaker the wizard's whole `answers` object also handed them
    // the *primary's* participant answers, so the two sides disagreed about
    // which questions exist — leaving a submission blocked on a question the
    // co-speaker's form never rendered.
    const snapshot = structuredClone(GOLDEN_SNAPSHOT);
    const participantSection = snapshot.sections.find((section) => section.key === "participant");
    if (!participantSection) throw new Error("fixture has no participant section");
    const gate = participantSection.fields[0];
    const dependent = participantSection.fields.find((field) => field.id !== gate?.id);
    if (!gate || !dependent) throw new Error("fixture needs two participant fields");
    dependent.required = true;
    dependent.visibility = { match: "all", conditions: [{ sourceFieldId: gate.id, op: "answered" }] };

    // The primary answered the gate; this co-speaker did not.
    const primaryAnswers = { [gate.id]: { t: "s" as const, v: "Primary" } };
    const coSpeakerAnswers = {};

    expect(abstractAnswersOnly(snapshot, primaryAnswers)).toEqual({});
    // With the abstract-only context the dependent stays hidden, so it is not
    // demanded of a co-speaker who never saw it.
    expect(stepFieldErrors(snapshot, ["participant"], coSpeakerAnswers, abstractAnswersOnly(snapshot, primaryAnswers))[dependent.id])
      .toBeUndefined();
    // Passing the primary's answers through is what produced the dead end.
    expect(stepFieldErrors(snapshot, ["participant"], coSpeakerAnswers, primaryAnswers)[dependent.id])
      .toEqual(expect.stringContaining("required"));
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
    expect(cfpStepHeading(GOLDEN_SNAPSHOT, "review")).toBe("Review your submission");
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

describe("CFP request and stale form recovery", () => {
  it("turns a stalled request into a retryable customer-facing result", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
    })));

    const pending = cfpRequest("/api/internal/auth/portal/request", {}, "POST", CFP_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(CFP_REQUEST_TIMEOUT_MS);

    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      message: "That request took too long. Check your connection and try again.",
      retryable: true,
      outcomeUnknown: true,
    });
    expect(cfpCodeRequestRecovery(result)).toEqual({
      acceptCode: true,
      message: "We couldn’t confirm whether the code was sent. If it arrives, enter it below; otherwise resend in a moment.",
      kind: "status",
    });
  });

  it("keeps code entry closed after a definite OTP rejection", () => {
    expect(cfpCodeRequestRecovery({
      ok: false,
      data: {},
      message: "Check your inbox, or try again in a few minutes",
      retryable: false,
    })).toEqual({
      acceptCode: false,
      message: "Check your inbox, or try again in a few minutes",
      kind: "error",
    });
  });

  it("provides actionable recovery when an error response has no message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 500 })));

    await expect(cfpRequest("/api/internal/forms/form-1/submit", {})).resolves.toMatchObject({
      ok: false,
      message: "We couldn’t complete that request. Try again.",
      retryable: true,
    });
  });

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
    const staleHtml = renderToStaticMarkup(React.createElement(CfpStaleRecovery, {
      failure: stale,
      unsavedEdits: false,
      onReload: () => undefined,
    }));

    expect(staleHtml).toContain("The organizer updated this form");
    expect(staleHtml).toContain("your saved draft will be restored");
    expect(staleHtml).toContain("Reloading restores only the last saved draft");
    expect(staleHtml).toContain("Reload updated form");
    expect(staleHtml).toContain('data-cfp-step-heading="true"');
    expect(staleHtml).toContain('tabindex="-1"');
    expect(staleHtml.match(/<button/g)).toHaveLength(1);
    expect(staleHtml).not.toContain("<form");
    expect(staleHtml).not.toContain("<input");
    expect(staleHtml).not.toContain("<textarea");
    expect(staleHtml).not.toContain("Back");
    expect(staleHtml).not.toContain(">Submit<");
    expect(staleHtml).not.toContain("Retry now");
  });

  it("visibly warns when the newest edits could not be saved", () => {
    const stale = cfpSubmitFailure({ ok: false, data: {}, code: "FORM_VERSION_STALE", message: "Form changed" });
    const staleHtml = renderToStaticMarkup(React.createElement(CfpStaleRecovery, {
      failure: stale,
      unsavedEdits: true,
      onReload: () => undefined,
    }));

    expect(staleHtml).toContain("Changes are not saved.");
    expect(staleHtml).toContain("Your most recent edits could not be saved.");
  });

  it("moves focus to the recovery heading and cancels pending focus on cleanup", () => {
    let scheduled: (() => void) | undefined;
    const focus = vi.fn();
    const schedule = vi.fn((callback: () => void) => {
      scheduled = callback;
      return 17;
    });
    const cancel = vi.fn();

    const cleanup = scheduleCfpRecoveryFocus({ focus }, schedule, cancel);
    expect(focus).not.toHaveBeenCalled();
    scheduled?.();
    expect(focus).toHaveBeenCalledOnce();
    cleanup();
    expect(cancel).toHaveBeenCalledWith(17);
  });

  it("routes an autosave stale response through the locked recovery gate", async () => {
    const lock = { submitting: false, versionStale: false, submitted: false };
    const states: AutosaveState[] = [];
    const onStale = vi.fn();

    await expect(saveCfpDraftWithRecovery(
      async () => ({ ok: false, data: {}, code: "FORM_VERSION_STALE", message: "Form changed" }),
      lock,
      (state) => states.push(state),
      onStale,
    )).resolves.toBe(false);

    expect(states).toEqual(["saving", "failed"]);
    expect(lock).toEqual({ submitting: false, versionStale: true, submitted: false });
    expect(beginCfpSubmit(lock)).toBe(false);
    const recovery = cfpStaleRecoveryState(onStale.mock.calls[0]?.[0] ?? null, true, lock);
    expect(recovery).toMatchObject({ failure: { kind: "stale" }, unsavedEdits: true });
    if (!recovery) throw new Error("Expected stale recovery");
    const staleHtml = renderToStaticMarkup(React.createElement(CfpStaleRecovery, {
      ...recovery,
      onReload: () => undefined,
    }));
    expect(staleHtml).toContain("Reload updated form");
    expect(staleHtml).not.toContain("<form");
  });

  it("leaves ordinary autosave failures editable", async () => {
    const lock = { submitting: false, versionStale: false, submitted: false };
    const onStale = vi.fn();

    await expect(saveCfpDraftWithRecovery(
      async () => ({ ok: false, data: {}, message: "Could not save" }),
      lock,
      () => undefined,
      onStale,
    )).resolves.toBe(false);

    expect(lock.versionStale).toBe(false);
    expect(onStale).not.toHaveBeenCalled();
    expect(cfpStaleRecoveryState(
      cfpSubmitFailure({ ok: false, data: {}, message: "Could not save" }),
      false,
      lock,
    )).toBeNull();
  });

  it("ignores an autosave stale response that arrives after submit succeeds", async () => {
    const lock = { submitting: false, versionStale: false, submitted: false };
    const states: AutosaveState[] = [];
    const onStale = vi.fn();
    let releaseSave: () => void = () => undefined;
    const pendingSave = saveCfpDraftWithRecovery(
      async () => {
        await new Promise<void>((resolve) => { releaseSave = resolve; });
        return { ok: false, data: {}, code: "FORM_VERSION_STALE", message: "Form changed" };
      },
      lock,
      (state) => states.push(state),
      onStale,
    );

    expect(states).toEqual(["saving"]);
    expect(beginCfpSubmit(lock)).toBe(true);
    settleCfpSubmitSuccess(lock);
    releaseSave();
    await expect(pendingSave).resolves.toBe(false);

    expect(lock).toEqual({ submitting: false, versionStale: false, submitted: true });
    expect(cfpAutosaveDisposition(lock)).toBe("discard");
    expect(onStale).not.toHaveBeenCalled();
    expect(states).toEqual(["saving"]);
    const lateStale = cfpSubmitFailure({ ok: false, data: {}, code: "FORM_VERSION_STALE", message: "Form changed" });
    expect(cfpStaleRecoveryState(lateStale, true, lock)).toBeNull();
  });

  it("clears an earlier stale lock when submit success becomes authoritative", () => {
    const lock = { submitting: true, versionStale: true, submitted: false };
    settleCfpSubmitSuccess(lock);
    expect(lock).toEqual({ submitting: false, versionStale: false, submitted: true });
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
    const lock = { submitting: false, versionStale: false, submitted: false };
    const stale = cfpSubmitFailure({ ok: false, data: {}, code: "FORM_VERSION_STALE", message: "Form changed" });

    expect(beginCfpSubmit(lock)).toBe(true);
    settleCfpSubmitFailure(lock, stale);
    expect(lock).toEqual({ submitting: false, versionStale: true, submitted: false });
    expect(beginCfpSubmit(lock)).toBe(false);
  });

  it("keeps ordinary submit failures retryable", () => {
    const lock = { submitting: false, versionStale: false, submitted: false };
    const ordinary = cfpSubmitFailure({ ok: false, data: {}, message: "Could not submit proposal" });

    expect(beginCfpSubmit(lock)).toBe(true);
    settleCfpSubmitFailure(lock, ordinary);
    expect(beginCfpSubmit(lock)).toBe(true);
  });

  it("aborts a locally rejected submit through the named lock transition", () => {
    const lock = { submitting: true, versionStale: false, submitted: false };
    abortCfpSubmit(lock);
    expect(lock).toEqual({ submitting: false, versionStale: false, submitted: false });
  });

  it("runs the page-reload recovery action", () => {
    const reload = vi.fn();
    reloadUpdatedCfpForm(reload);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("CFP deferred autosave settlement", () => {
  it("persists the skipped snapshot after an ordinary submit failure", async () => {
    const lock = { submitting: false, versionStale: false, submitted: false };
    const deferred = createDeferredCfpAutosave<{ revision: number }>();
    const states: AutosaveState[] = [];
    const persist = vi.fn(async () => {
      states.push("saving", "saved");
      return true;
    });
    const ordinary = cfpSubmitFailure({ ok: false, data: {}, message: "Could not submit proposal" });

    expect(beginCfpSubmit(lock)).toBe(true);
    expect(cfpAutosaveDisposition(lock)).toBe("defer");
    expect(deferred.defer({ revision: 2 }, (state) => states.push(state))).toBe(false);
    expect(deferred.defer({ revision: 3 }, (state) => states.push(state))).toBe(false);
    expect(deferred.hasPending()).toBe(true);
    settleCfpSubmitFailure(lock, ordinary);

    await expect(deferred.settle("ordinary-failure", persist)).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({ revision: 3 });
    expect(deferred.hasPending()).toBe(false);
    expect(states).toEqual(["failed", "failed", "saving", "saved"]);
    expect(cfpAutosaveDisposition(lock)).toBe("save");
  });

  it("keeps a skipped snapshot failed and locked after a stale submit failure", async () => {
    const lock = { submitting: false, versionStale: false, submitted: false };
    const deferred = createDeferredCfpAutosave<{ revision: number }>();
    const states: AutosaveState[] = [];
    const persist = vi.fn(async () => true);
    const stale = cfpSubmitFailure({ ok: false, data: {}, code: "FORM_VERSION_STALE", message: "Form changed" });

    expect(beginCfpSubmit(lock)).toBe(true);
    expect(deferred.defer({ revision: 2 }, (state) => states.push(state))).toBe(false);
    settleCfpSubmitFailure(lock, stale);

    await expect(deferred.settle("stale-failure", persist)).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();
    expect(states).toEqual(["failed"]);
    expect(states).not.toContain("saved");
    expect(cfpAutosaveDisposition(lock)).toBe("fail");
  });

  it("discards a skipped snapshot after success without patching the promoted draft", async () => {
    const lock = { submitting: false, versionStale: false, submitted: false };
    const deferred = createDeferredCfpAutosave<{ revision: number }>();
    const persist = vi.fn(async () => true);

    expect(beginCfpSubmit(lock)).toBe(true);
    deferred.defer({ revision: 2 }, () => undefined);
    settleCfpSubmitSuccess(lock);

    await expect(deferred.settle("success", persist)).resolves.toBeNull();
    await expect(deferred.settle("ordinary-failure", persist)).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();
    expect(cfpAutosaveDisposition(lock)).toBe("discard");
    expect(beginCfpSubmit(lock)).toBe(false);
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
