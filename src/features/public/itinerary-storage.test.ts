import { describe, expect, it } from "vitest";
import { reconcileStarredIds, readStarredIds, toggleStarredId, writeStarredIds } from "./itinerary-storage";

describe("itinerary-storage (M53 anonymous itinerary)", () => {
  it("toggleStarredId adds an unstarred id and removes an already-starred one", () => {
    expect(toggleStarredId([], "a")).toEqual(["a"]);
    expect(toggleStarredId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleStarredId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("reconcileStarredIds keeps only ids still in the published set, preserving star order", () => {
    const published = new Set(["a", "c"]);
    expect(reconcileStarredIds(["a", "b", "c"], published)).toEqual(["a", "c"]);
  });

  it("reconcileStarredIds drops an id whose session was later unpublished or deleted", () => {
    const published = new Set(["a"]);
    expect(reconcileStarredIds(["a", "removed"], published)).toEqual(["a"]);
  });

  it("reconcileStarredIds de-duplicates a corrupted stored list", () => {
    const published = new Set(["a", "b"]);
    expect(reconcileStarredIds(["a", "a", "b"], published)).toEqual(["a", "b"]);
  });

  it("reconcileStarredIds returns [] once every starred session is gone", () => {
    expect(reconcileStarredIds(["x", "y"], new Set())).toEqual([]);
  });

  it("readStarredIds is [] with no window (server render) instead of throwing", () => {
    expect(readStarredIds("some-event")).toEqual([]);
  });

  it("writeStarredIds is a no-op with no window instead of throwing", () => {
    expect(() => writeStarredIds("some-event", ["a"])).not.toThrow();
  });
});
