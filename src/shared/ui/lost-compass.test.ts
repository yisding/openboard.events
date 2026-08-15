import { describe, expect, it } from "vitest";
import { compassStage } from "./lost-compass";

describe("compassStage", () => {
  it("wanders until the fifth spin finds true north", () => {
    expect(compassStage(0)).toBe("wandering");
    expect(compassStage(4)).toBe("wandering");
    expect(compassStage(5)).toBe("found");
  });

  it("rewards persistence: ten spins find true north twice", () => {
    expect(compassStage(9)).toBe("found");
    expect(compassStage(10)).toBe("legend");
    expect(compassStage(50)).toBe("legend");
  });
});
