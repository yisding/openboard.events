import { afterEach, describe, expect, it, vi } from "vitest";
import { randomInt } from "./crypto";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("randomInt", () => {
  it("rejects the biased tail and returns an integer below the bound", () => {
    const samples = [0xffff_ffff, 123];
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = samples.shift() ?? 0;
      return array;
    });

    expect(randomInt(10)).toBe(3);
    expect(samples).toHaveLength(0);
  });

  it("rejects invalid bounds", () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(1.5)).toThrow(RangeError);
    expect(() => randomInt(0x1_0000_0001)).toThrow(RangeError);
  });
});
