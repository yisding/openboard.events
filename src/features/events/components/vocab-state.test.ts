import { describe, expect, it } from "vitest";
import { restoreFailedVocabDeletion, restoreVocabItemAtIndex } from "./vocab-state";

describe("restoreVocabItemAtIndex", () => {
  it("puts a failed middle deletion back at its original position", () => {
    const removed = { id: "b", name: "B" };
    expect(restoreVocabItemAtIndex([{ id: "a", name: "A" }, { id: "c", name: "C" }], removed, 1))
      .toEqual([{ id: "a", name: "A" }, removed, { id: "c", name: "C" }]);
  });

  it("does not duplicate a row already restored by a concurrent refresh", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(restoreVocabItemAtIndex(rows, { id: "b" }, 1)).toEqual(rows);
  });

  it("clamps an original index beyond the current list to the end", () => {
    expect(restoreVocabItemAtIndex([{ id: "a" }, { id: "b" }], { id: "c" }, 99))
      .toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("uses the latest persisted item when a failed delete races with a save", () => {
    const removed = { id: "b", name: "Old name" };
    const persisted = { id: "b", name: "Saved name" };
    expect(restoreFailedVocabDeletion([{ id: "a", name: "A" }], removed, 1, persisted))
      .toEqual([{ id: "a", name: "A" }, persisted]);
  });
});
