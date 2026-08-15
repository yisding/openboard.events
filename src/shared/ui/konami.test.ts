import { describe, expect, it } from "vitest";
import { konamiEncore } from "./konami";

describe("konamiEncore", () => {
  it("gives each repeat trigger its own celebration", () => {
    const first = konamiEncore(0);
    const second = konamiEncore(1);
    const third = konamiEncore(2);

    expect(first.message).not.toBe(second.message);
    expect(second.message).not.toBe(third.message);
    expect(first.emojis).not.toEqual(second.emojis);
  });

  it("settles on the closer instead of running out of show", () => {
    expect(konamiEncore(2)).toEqual(konamiEncore(3));
    expect(konamiEncore(2)).toEqual(konamiEncore(100));
  });
});
