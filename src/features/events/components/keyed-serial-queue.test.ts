import { describe, expect, it } from "vitest";
import { KeyedSerialQueue } from "./keyed-serial-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe("KeyedSerialQueue", () => {
  it("runs edits for one row in order", async () => {
    const queue = new KeyedSerialQueue();
    const first = deferred<void>();
    const calls: string[] = [];

    const firstRun = queue.run("track-1", async () => { calls.push("name:start"); await first.promise; calls.push("name:end"); });
    const secondRun = queue.run("track-1", async () => { calls.push("color"); });
    await Promise.resolve();
    expect(calls).toEqual(["name:start"]);

    first.resolve();
    await Promise.all([firstRun, secondRun]);
    expect(calls).toEqual(["name:start", "name:end", "color"]);
  });

  it("continues with the next edit after a failed save", async () => {
    const queue = new KeyedSerialQueue();
    const calls: string[] = [];
    const failed = queue.run("room-1", async () => { calls.push("failed"); throw new Error("offline"); });
    const recovered = queue.run("room-1", async () => { calls.push("recovered"); return true; });

    await expect(failed).rejects.toThrow("offline");
    await expect(recovered).resolves.toBe(true);
    expect(calls).toEqual(["failed", "recovered"]);
  });
});
