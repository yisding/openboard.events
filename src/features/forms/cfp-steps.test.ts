import { describe, expect, it, vi } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { saveWithRetry, serializeAutosaves, stepForErrors, type AutosaveState } from "./components/cfp-steps";

const fieldId = (key: string) => {
  const field = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Missing field ${key}`);
  return field.id;
};

describe("CFP validation routing", () => {
  it("returns participant errors to the speaker step", () => {
    expect(stepForErrors(GOLDEN_SNAPSHOT, { [fieldId("first_name")]: "First name is required" })).toBe("speaker");
  });

  it("returns abstract errors to the submission step", () => {
    expect(stepForErrors(GOLDEN_SNAPSHOT, { [fieldId("title")]: "Title is required" })).toBe("submission");
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
