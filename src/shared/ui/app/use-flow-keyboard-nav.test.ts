import { describe, expect, it } from "vitest";
import { nextFlowId } from "./use-flow-keyboard-nav";

describe("nextFlowId", () => {
  const ids = ["a", "b", "c"];

  it("steps to the next id", () => {
    expect(nextFlowId(ids, "a", "next")).toBe("b");
    expect(nextFlowId(ids, "b", "next")).toBe("c");
  });

  it("steps to the previous id", () => {
    expect(nextFlowId(ids, "c", "prev")).toBe("b");
    expect(nextFlowId(ids, "b", "prev")).toBe("a");
  });

  it("does not wrap at either end", () => {
    expect(nextFlowId(ids, "c", "next")).toBeUndefined();
    expect(nextFlowId(ids, "a", "prev")).toBeUndefined();
  });

  it("returns undefined when the active id is not in the list", () => {
    expect(nextFlowId(ids, "z", "next")).toBeUndefined();
  });
});
