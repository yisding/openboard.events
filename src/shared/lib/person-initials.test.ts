import { describe, expect, it } from "vitest";
import { personInitials } from "./person-initials";

describe("personInitials", () => {
  it("takes the first letter of the first and last name, not the first two letters of the first name", () => {
    expect(personInitials("Aisha Bello")).toBe("AB");
  });

  it("uses a middle name's initial as the second letter, not the first name's", () => {
    expect(personInitials("Mary Jane Watson")).toBe("MW");
  });

  it("falls back to the single letter available for a one-word name", () => {
    expect(personInitials("Madonna")).toBe("M");
  });

  it("falls back rather than rendering an empty mark", () => {
    expect(personInitials("   ")).toBe("?");
  });
});
