import { describe, expect, it, vi } from "vitest";
import {
  compareOutboxRows,
  drainOutbox,
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

  it("uses bounded concurrency while continuing after row failures", async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, attempts: index === 1 ? 6 : 1 }));
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

  it("lets a feature classify permanent errors", async () => {
    const transitionFailure = vi.fn(async () => undefined);
    await drainOutbox({
      requestedBudget: 1,
      claim: async () => [{ attempts: 1 }],
      deliver: async () => { throw new Error("invalid template"); },
      deliveryKey: () => "recipient",
      isTerminalError: (_row, error) => error instanceof Error && error.message === "invalid template",
      transitionFailure,
    });
    expect(transitionFailure).toHaveBeenCalledWith(
      { attempts: 1 },
      { outcome: "failed", errorMessage: "invalid template" },
    );
  });
});
