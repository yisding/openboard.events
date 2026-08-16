import { describe, expect, it } from "vitest";
import { canDeleteVocabItem, restoreFailedVocabDeletion, restoreVocabItemAtIndex, restoreVocabOrder, roomDeletionImpactCopy } from "./vocab-state";

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

describe("restoreVocabOrder", () => {
  it("restores persisted order while preserving concurrent edits, additions, and deletions", () => {
    expect(restoreVocabOrder([
      { id: "c", name: "C edited" },
      { id: "a", name: "A" },
      { id: "d", name: "D added" },
    ], ["a", "b", "c"])).toEqual([
      { id: "a", name: "A" },
      { id: "c", name: "C edited" },
      { id: "d", name: "D added" },
    ]);
  });
});

describe("canDeleteVocabItem", () => {
  it("blocks deletion while a reorder mutation is pending", () => {
    expect(canDeleteVocabItem(true)).toBe(false);
    expect(canDeleteVocabItem(false)).toBe(true);
  });
});

describe("roomDeletionImpactCopy", () => {
  const ready = (sessions: number, publishedSessions: number, speakers: number) =>
    roomDeletionImpactCopy({ status: "ready", impact: { sessions, publishedSessions, speakers } });

  it("promises mail exactly when mail is actually sent", () => {
    // The one distinction the organizer is deciding on: an empty or unpublished
    // room is a private edit, a published one reaches other people's calendars.
    expect(ready(0, 0, 0)).toContain("Nothing is scheduled");
    expect(ready(2, 0, 0)).toContain("no one is emailed");
    // Placed and published, but nobody is assigned to speak in them yet.
    expect(ready(2, 2, 0)).toContain("no one is emailed");
    expect(ready(3, 2, 4)).toContain("4 speakers will be emailed");
  });

  it("counts in whole sentences rather than pluralized fragments", () => {
    expect(ready(1, 1, 1)).toBe("1 session loses its room. It is published, so 1 speaker will be emailed that the schedule changed.");
    expect(ready(3, 2, 4)).toBe("3 sessions lose their room. 2 of them are published, so 4 speakers will be emailed that the schedule changed.");
  });

  it("never lets a failed or pending read read as an all-clear", () => {
    expect(roomDeletionImpactCopy({ status: "loading" })).toContain("Checking");
    expect(roomDeletionImpactCopy({ status: "unavailable" })).toContain("could not be checked");
    expect(roomDeletionImpactCopy({ status: "unavailable" })).not.toContain("Nothing is scheduled");
  });
});
