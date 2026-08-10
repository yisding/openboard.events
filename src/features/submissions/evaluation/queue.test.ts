import { describe, expect, it } from "vitest";
import { nextCriterionToScore, nextUnscored } from "./queue";

const criteria = [{ id: "relevance" }, { id: "quality" }];

describe("nextCriterionToScore", () => {
  it("fills the criteria in reading order", () => {
    expect(nextCriterionToScore(criteria, {})?.id).toBe("relevance");
    expect(nextCriterionToScore(criteria, { relevance: 4 })?.id).toBe("quality");
  });

  it("revises the first once they all have a number", () => {
    // Otherwise the number keys go dead the moment a reviewer finishes a round.
    expect(nextCriterionToScore(criteria, { relevance: 4, quality: 5 })?.id).toBe("relevance");
  });

  it("has nothing to fill on a round without criteria", () => {
    expect(nextCriterionToScore([], {})).toBeUndefined();
  });
});

describe("nextUnscored", () => {
  const rows = [
    { submissionId: "a", myScore: 4 },
    { submissionId: "b", myScore: null },
    { submissionId: "c", myScore: null },
  ];

  it("moves to the next proposal that still needs a verdict", () => {
    expect(nextUnscored(rows, "b")?.submissionId).toBe("c");
  });

  it("wraps rather than walking back through finished work", () => {
    expect(nextUnscored(rows, "c")?.submissionId).toBe("b");
  });

  it("stops when the queue is done", () => {
    expect(nextUnscored([{ submissionId: "a", myScore: 5 }], "a")).toBeUndefined();
  });
});
