import { describe, expect, it, vi } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import {
  cfpFlowSteps,
  hasIncompleteParticipantEmail,
  participantEmail,
  participantFieldIds,
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
    expect(hasIncompleteParticipantEmail(GOLDEN_SNAPSHOT, [{ clientId: "co-1", answers: {} }])).toBe(true);
    expect(hasIncompleteParticipantEmail(GOLDEN_SNAPSHOT, [{
      clientId: "co-1",
      answers: { [fieldId("email")]: { t: "s", v: "co@example.com" } },
    }])).toBe(false);
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
