import { describe, expect, it } from "vitest";
import { eventInitials, shortEventName } from "./event-label";

describe("shortEventName", () => {
  it("drops the qualifier after an em dash, en dash or hyphen", () => {
    expect(shortEventName("AI.Engineer Sandbox — NYC")).toBe("AI.Engineer Sandbox");
    expect(shortEventName("AI.Engineer Sandbox – NYC")).toBe("AI.Engineer Sandbox");
    expect(shortEventName("AI.Engineer Sandbox - NYC")).toBe("AI.Engineer Sandbox");
  });

  it("drops the qualifier after a colon", () => {
    expect(shortEventName("Openboard: The Conference")).toBe("Openboard");
  });

  // A hyphen inside a word is part of the name, not a qualifier.
  it("keeps a hyphenated word intact", () => {
    expect(shortEventName("Re-Frame 2026")).toBe("Re-Frame 2026");
  });

  it("truncates a long single-part name rather than overflowing the chrome", () => {
    expect(shortEventName("The Extremely Long Annual Gathering Of People")).toBe("The Extremely Long Annual G…");
  });

  it("never returns an empty label", () => {
    expect(shortEventName("   ")).toBe("");
    expect(shortEventName("Openboard")).toBe("Openboard");
  });
});

describe("eventInitials", () => {
  it("takes one letter per word, up to the requested width", () => {
    expect(eventInitials("AI Engineer Sandbox")).toBe("AE");
    expect(eventInitials("AI Engineer Sandbox", 3)).toBe("AES");
  });

  it("takes leading letters when the name is one word", () => {
    expect(eventInitials("Openboard")).toBe("OP");
    expect(eventInitials("Openboard", 3)).toBe("OPE");
  });

  it("splits on punctuation, so a dotted brand still yields two marks", () => {
    expect(eventInitials("AI.Engineer Sandbox — NYC")).toBe("AE");
  });

  it("falls back rather than rendering an empty mark", () => {
    expect(eventInitials("— —")).toBe("EV");
  });
});
