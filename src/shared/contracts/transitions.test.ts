import { describe, expect, it } from "vitest";
import { SUBMISSION_STATUSES, SUBMISSION_TRANSITIONS, canTransition } from "./index";

describe("submission transition contract", () => {
  it("defines every status exactly once", () => {
    expect(Object.keys(SUBMISSION_TRANSITIONS)).toEqual(SUBMISSION_STATUSES);
  });

  it("covers the full 7 by 7 matrix", () => {
    const matrix = SUBMISSION_STATUSES.flatMap((from) => SUBMISSION_STATUSES.map((to) => [from, to, canTransition(from, to)] as const));
    expect(matrix).toHaveLength(49);
    expect(matrix.find(([from, to]) => from === "draft" && to === "accepted")?.[2]).toBe(false);
    expect(matrix.find(([from, to]) => from === "accepted" && to === "pending")?.[2]).toBe(true);
  });
});
