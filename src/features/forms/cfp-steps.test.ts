import { describe, expect, it, vi } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import {
  CFP_PORTAL_REDIRECT_MS,
  cfpFlowSteps,
  cfpStepHeading,
  hasIncompleteParticipantEmail,
  participantEmail,
  participantFieldIds,
  requiredStepErrors,
  schedulePortalRedirect,
  saveWithRetry,
  serializeAutosaves,
  stepForErrors,
  type AutosaveState,
} from "./components/cfp-steps";

const fieldId = (key: string) => {
  const field = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Missing field ${key}`);
  return field.id;
};

describe("CFP validation routing", () => {
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
    expect(requiredStepErrors(GOLDEN_SNAPSHOT, ["abstract"], {})).toMatchObject({
      [fieldId("title")]: expect.stringContaining("required"),
    });
    expect(requiredStepErrors(GOLDEN_SNAPSHOT, ["abstract"], {
      [fieldId("title")]: { t: "s", v: "An accessible proposal" },
    })[fieldId("title")]).toBeUndefined();
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
