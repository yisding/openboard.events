import { describe, expect, it } from "vitest";
import { restoreVocabItemAtIndex } from "./vocab-state";

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
});
