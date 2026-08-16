import { describe, expect, it } from "vitest";
import { EMPTY_ABSTRACT_FIELDS, toCreateBody, toPatch, type AbstractFieldValues } from "./abstract-fields";

const values = (overrides: Partial<AbstractFieldValues> = {}): AbstractFieldValues => ({
  ...EMPTY_ABSTRACT_FIELDS,
  title: "Agents in production",
  ...overrides,
});

describe("toPatch", () => {
  it("sends only the fields that changed", () => {
    const original = values();
    expect(toPatch(original, original)).toEqual({});
    expect(toPatch(values({ title: "Agents in production, revisited" }), original)).toEqual({
      title: "Agents in production, revisited",
    });
  });

  // A submission with no description opens with an empty editor, and an empty
  // rich text document round-trips as `<p></p>`. Reading that as an edit armed
  // the unsaved-work guard on a drawer the organizer never typed into.
  it("does not call an empty description an edit, whichever empty markup it holds", () => {
    const original = values({ descriptionHtml: "" });
    expect(toPatch(values({ descriptionHtml: "<p></p>" }), original)).toEqual({});
    expect(toPatch(values({ descriptionHtml: "<p><br></p>" }), original)).toEqual({});
  });

  it("clears a description that was emptied, and sends one that was written", () => {
    const described = values({ descriptionHtml: "<p>A talk about scaling human review.</p>" });
    expect(toPatch(values({ descriptionHtml: "<p></p>" }), described)).toEqual({ descriptionHtml: null });
    expect(toPatch(described, values({ descriptionHtml: "" }))).toEqual({
      descriptionHtml: "<p>A talk about scaling human review.</p>",
    });
  });
});

describe("toCreateBody", () => {
  it("stores an untouched editor as no description rather than an empty paragraph", () => {
    expect(toCreateBody(values({ descriptionHtml: "<p></p>" }), "pending").descriptionHtml).toBeNull();
  });
});
