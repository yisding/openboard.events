import { describe, expect, it } from "vitest";
import { repairedOptionList } from "./form-builder";

describe("repairedOptionList", () => {
  const existing = [{ id: "id1", label: "Workshop" }, { id: "id2", label: "Talk" }];

  it("keeps an option's id with its own label when an earlier line is deleted", () => {
    // The Options textarea used to rebuild by array index, so deleting the
    // Workshop line slid every id up one and left `id1 -> "Talk"`. The
    // inspector hands that unsaved list straight to the visibility condition
    // editor, which stores `option.id` — so a rule built as "Format is Talk"
    // persisted `id1`, still Workshop on the server. The rule then means the
    // opposite of what was picked, and nothing errors.
    expect(repairedOptionList(existing, ["Talk"])).toEqual([{ id: "id2", label: "Talk" }]);
  });

  it("preserves ids through a reorder", () => {
    expect(repairedOptionList(existing, ["Talk", "Workshop"])).toEqual([
      { id: "id2", label: "Talk" },
      { id: "id1", label: "Workshop" },
    ]);
  });

  it("treats an edit in place as the same option, reusing its id", () => {
    expect(repairedOptionList(existing, ["Workshops", "Talk"])).toEqual([
      { id: "id1", label: "Workshops" },
      { id: "id2", label: "Talk" },
    ]);
  });

  it("mints an id for a genuinely new option", () => {
    const next = repairedOptionList(existing, ["Workshop", "Talk", "Panel"]);
    expect(next.slice(0, 2)).toEqual(existing);
    expect(next[2]?.label).toBe("Panel");
    expect(next[2]?.id).not.toBe("id1");
    expect(next[2]?.id).not.toBe("id2");
  });

  it("keeps a blank line so pressing Enter does not delete the line being typed", () => {
    // Blanks survive here and are stripped by `saveField` instead: the route
    // rejects an empty label, which used to discard the whole patch.
    const next = repairedOptionList(existing, ["Workshop", "Talk", ""]);
    expect(next).toHaveLength(3);
    expect(next[2]?.label).toBe("");
    // A blank must not consume a real option's id.
    expect(next.slice(0, 2)).toEqual(existing);
  });

  it("does not let a blank line mid-list steal the next option's id", () => {
    // Enter pressed between two options. If the blank claimed `id2`, "Talk"
    // would fall through to a fresh id and every visibility rule naming it
    // would silently stop matching on the next save.
    expect(repairedOptionList(existing, ["Workshop", "", "Talk"])).toEqual([
      { id: "id1", label: "Workshop" },
      { id: "draft-1", label: "" },
      { id: "id2", label: "Talk" },
    ]);
  });
});
