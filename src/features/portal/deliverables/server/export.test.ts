import { describe, expect, it } from "vitest";
import { EXPORT_PART_TARGET_BYTES, planExportBatch } from "./export";

/**
 * `planExportBatch` is the pure boundary decision M52-ZIP's rewrite hinges
 * on: how many files (and how many bytes) one processing step is allowed to
 * touch. Covered here without a database or R2 binding, independent of
 * `processFileExportJobIn`'s own PGlite integration coverage
 * (`tests/integration/deliverables.test.ts`), which — with no fake R2
 * binding available in this environment — can only exercise the
 * before-any-byte-is-read failure path.
 */
describe("planExportBatch", () => {
  const row = (id: string, sizeBytes: number) => ({ id, sizeBytes });
  const byId = (rows: { id: string; sizeBytes: number }[]) => new Map(rows.map((r) => [r.id, r]));

  it("keeps adding rows until the byte target is met, then stops", () => {
    const rows = byId([row("a", 1_000_000), row("b", 2_000_000), row("c", 5_000_000), row("d", 1_000_000)]);
    const { batch, consumed } = planExportBatch(["a", "b", "c", "d"], rows, 3_000_000);
    // a + b = 3,000,000 already meets the target; c and d are left for a
    // later step.
    expect(batch.map((r) => r.id)).toEqual(["a", "b"]);
    expect(consumed).toBe(2);
  });

  it("a single row already at or past the target becomes its own one-row batch", () => {
    const rows = byId([row("big", 50_000_000), row("small", 1)]);
    const { batch, consumed } = planExportBatch(["big", "small"], rows, EXPORT_PART_TARGET_BYTES);
    expect(batch.map((r) => r.id)).toEqual(["big"]);
    expect(consumed).toBe(1);
  });

  it("consumes every remaining id (batch < target) once the id list itself runs out", () => {
    const rows = byId([row("a", 100), row("b", 200)]);
    const { batch, consumed } = planExportBatch(["a", "b"], rows, EXPORT_PART_TARGET_BYTES);
    expect(batch.map((r) => r.id)).toEqual(["a", "b"]);
    expect(consumed).toBe(2);
  });

  it("advances past a gap (an id with no resolvable row) instead of stalling on it", () => {
    const rows = byId([row("a", 100)]);
    // "missing" has no entry in `rows` — its object vanished, in the
    // language `processFileExportJobIn`'s own comments use.
    const { batch, consumed } = planExportBatch(["missing", "a"], rows, EXPORT_PART_TARGET_BYTES);
    expect(batch.map((r) => r.id)).toEqual(["a"]);
    // Both positions were consulted even though only one resolved — this is
    // what lets a caller's `nextIndex` skip the gap for good rather than
    // reconsidering it on every future step.
    expect(consumed).toBe(2);
  });

  it("an empty id list plans an empty, zero-consumed batch", () => {
    const { batch, consumed } = planExportBatch([], byId([]), EXPORT_PART_TARGET_BYTES);
    expect(batch).toEqual([]);
    expect(consumed).toBe(0);
  });
});
