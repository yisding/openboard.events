import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The tab badge and the section heading under it must count the same set.
 *
 * They did not: the badges were computed from the raw `tasks` array while the
 * heading derived from `shown`, which applies the open/completed/overdue filter
 * that defaults to "open". A speaker with 8 assignments and 6 complete read the
 * tab "My tasks 8" directly above the heading "My tasks 2" — the same words,
 * two numbers, one screen. The file's own header states the rule: "A count that
 * comes from a second query is a count that eventually disagrees with the list
 * under it."
 *
 * The progress figure is deliberately *not* filtered: "6/8 tasks complete" over
 * a filtered set would mean nothing.
 */
describe("portal task list counts", () => {
  const source = readFileSync(new URL("./components/task-list.tsx", import.meta.url), "utf8");

  it("computes the tab badges from the filtered set, and progress from everything", () => {
    expect(source).toContain("const inFilter = tasks.filter(matchesFilter)");
    expect(source).toContain("mine: inFilter.filter((task) => task.submissionId === null).length");
    expect(source).toContain("submissions: inFilter.filter((task) => task.submissionId !== null).length");

    // Progress stays over the whole array.
    expect(source).toContain("all: tasks.length");
    expect(source).toContain("done: tasks.filter((task) => task.completed).length");
    expect(source).toContain("{progress.done}/{progress.all}");
  });

  it("shares one filter predicate between the badges and the list", () => {
    // `shown` and `counts` must not each carry their own copy of the rule.
    expect(source).toContain("const matchesFilter = useCallback");
    expect(source.match(/return matchesFilter\(task\);/gu) ?? []).toHaveLength(1);
  });
});
