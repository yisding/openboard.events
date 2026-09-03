import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/lib/errors";
import {
  compareOutboxRows,
  drainOutbox,
  drainOutboxUntilQuiet,
  outboxBudget,
  outboxErrorMessage,
  outboxRetryDelayMinutes,
  type OutboxFailureTransition,
} from "./outbox-engine";

describe("shared outbox engine", () => {
  it("normalizes claim budgets and retry delays", () => {
    expect(outboxBudget(Number.NaN)).toBe(50);
    expect(outboxBudget(0)).toBe(1);
    expect(outboxBudget(3.9)).toBe(3);
    expect(outboxBudget(500)).toBe(50);
    expect(outboxRetryDelayMinutes(1)).toBe(2);
    expect(outboxRetryDelayMinutes(6)).toBe(60);
    expect(outboxErrorMessage("x".repeat(1_200))).toHaveLength(1_000);
    const later = new Date("2026-08-14T01:00:01Z");
    const earlier = new Date("2026-08-14T01:00:00Z");
    expect([
      { id: "b", createdAt: earlier },
      { id: "a", createdAt: later },
      { id: "a", createdAt: earlier },
    ].sort(compareOutboxRows).map((row) => `${row.createdAt.toISOString()}:${row.id}`)).toEqual([
      `${earlier.toISOString()}:a`,
      `${earlier.toISOString()}:b`,
      `${later.toISOString()}:a`,
    ]);
  });

  it("persists structured AppError details for terminal diagnostics", () => {
    const error = new AppError("VALIDATION", "stored snapshot is invalid", {
      properties: { startsAt: { errors: ["Invalid datetime"] } },
    });
    expect(outboxErrorMessage(error)).toContain(
      'details={"properties":{"startsAt":{"errors":["Invalid datetime"]}}}',
    );
  });

  it("uses bounded concurrency while continuing after row failures", async () => {
    // The exhausted row also carries the delivery error that got it there: the
    // attempt count alone no longer retires a message, since `attempts` counts
    // claims and a claim can end without ever reaching the provider.
    const rows = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      attempts: index === 1 ? 6 : 1,
      error: index === 1 ? "provider unavailable" : null,
    }));
    const transitions: Array<{ id: number; transition: OutboxFailureTransition }> = [];
    let active = 0;
    let maxActive = 0;
    const activeKeys = new Set<number>();
    let started = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstWave: (() => void) | undefined;
    const firstWaveStarted = new Promise<void>((resolve) => { firstWave = resolve; });

    const draining = drainOutbox<(typeof rows)[number]>({
      requestedBudget: 500,
      claim: vi.fn(async (budget: number) => {
        expect(budget).toBe(50);
        return rows;
      }),
      concurrency: 3,
      deliver: async (row) => {
        const key = Math.ceil(row.id / 2);
        expect(activeKeys.has(key), `delivery lane ${key} overlapped itself`).toBe(false);
        activeKeys.add(key);
        active += 1;
        maxActive = Math.max(maxActive, active);
        started += 1;
        if (started === 3) firstWave?.();
        await gate;
        active -= 1;
        activeKeys.delete(key);
        if (row.id === 1) throw new Error("provider unavailable");
        if (row.id === 2) throw new Error("attempt budget exhausted");
        return row.id === 3 ? "skipped" : "sent";
      },
      deliveryKey: (row) => String(Math.ceil(row.id / 2)),
      isTerminalError: () => false,
      transitionFailure: async (row, transition) => {
        transitions.push({ id: row.id, transition });
      },
    });

    await firstWaveStarted;
    expect(started).toBe(3);
    expect(maxActive).toBe(3);
    release?.();
    await expect(draining).resolves.toEqual({
      claimed: 7,
      sent: 4,
      skipped: 1,
      failed: 1,
      retried: 1,
    });
    expect(transitions).toEqual([
      { id: 1, transition: { outcome: "retried", errorMessage: "provider unavailable", retryDelayMinutes: 2 } },
      { id: 2, transition: { outcome: "failed", errorMessage: "attempt budget exhausted" } },
    ]);
  });

  it("does not retire a message whose attempts were spent on claims that never reached delivery", async () => {
    // `attempts` is bumped when a row is claimed, so a tick that dies partway
    // burns the budget of every row it never got to. Retiring on that count
    // alone would mark a never-delivered message `failed` and null its sealed
    // payload — an unrecoverable drop. A row that genuinely failed delivery
    // carries `error`; one that was only ever claimed does not.
    const transitions: OutboxFailureTransition[] = [];
    await drainOutbox<{ id: number; attempts: number; error: string | null }>({
      requestedBudget: 2,
      claim: async () => [
        { id: 1, attempts: 9, error: null },
        { id: 2, attempts: 9, error: "provider unavailable" },
      ],
      deliver: async () => { throw new Error("provider unavailable"); },
      deliveryKey: (row) => String(row.id),
      isTerminalError: () => false,
      transitionFailure: async (_row, transition) => { transitions.push(transition); },
    });

    // Never delivered before: this failure is its first, so it retries.
    expect(transitions[0]?.outcome).toBe("retried");
    // Already failed delivery at the cap: retired.
    expect(transitions[1]?.outcome).toBe("failed");
  });

  it("lets a feature classify permanent errors", async () => {
    const transitionFailure = vi.fn(async () => undefined);
    await drainOutbox({
      requestedBudget: 1,
      claim: async () => [{ attempts: 1, error: null }],
      deliver: async () => { throw new Error("invalid template"); },
      deliveryKey: () => "recipient",
      isTerminalError: (_row, error) => error instanceof Error && error.message === "invalid template",
      transitionFailure,
    });
    expect(transitionFailure).toHaveBeenCalledWith(
      { attempts: 1, error: null },
      { outcome: "failed", errorMessage: "invalid template" },
    );
  });

  it("settles every independent lane before surfacing a transition failure", async () => {
    const delivered: number[] = [];
    const draining = drainOutbox({
      requestedBudget: 4,
      claim: async () => [
        { id: 1, attempts: 1, error: null },
        { id: 2, attempts: 1, error: null },
        { id: 3, attempts: 1, error: null },
        { id: 4, attempts: 1, error: null },
      ],
      concurrency: 2,
      deliver: async (row) => {
        delivered.push(row.id);
        if (row.id === 1) throw new Error("provider unavailable");
        return "sent";
      },
      deliveryKey: (row) => String(row.id),
      isTerminalError: () => false,
      transitionFailure: async (row) => {
        if (row.id === 1) throw new Error("transition database unavailable");
      },
    });

    await expect(draining).rejects.toThrow("transition database unavailable");
    expect(delivered.sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
  });

  describe("recovery sweep", () => {
    const batch = (claimed: number) => ({ claimed, sent: claimed, skipped: 0, failed: 0, retried: 0 });

    it("keeps claiming while batches come back full and stops on the first short one", async () => {
      const queue = [50, 50, 20, 50];
      const dispatch = vi.fn(async () => batch(queue.shift() ?? 0));

      const stats = await drainOutboxUntilQuiet(dispatch);

      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(stats).toEqual(batch(120));
    });

    it("stops after the pass cap and the wall budget even when the queue is not quiet", async () => {
      const capped = vi.fn(async () => batch(50));
      expect((await drainOutboxUntilQuiet(capped, { passes: 2 })).claimed).toBe(100);
      expect(capped).toHaveBeenCalledTimes(2);

      let clock = 0;
      const slow = vi.fn(async () => { clock += 40_000; return batch(50); });
      expect((await drainOutboxUntilQuiet(slow, { budgetMs: 60_000, now: () => clock })).claimed).toBe(100);
      expect(slow).toHaveBeenCalledTimes(2);
    });
  });
});
