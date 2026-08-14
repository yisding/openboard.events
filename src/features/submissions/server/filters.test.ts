import { describe, expect, it } from "vitest";
import { parseSubmissionFiltersForPage, submissionFiltersSchema } from "./filters";

/**
 * The Abstracts filters arrive over HTTP, and over HTTP every value is a
 * string: `defineHandler` builds its GET input straight out of
 * `URLSearchParams`. The two pagination parameters were declared as bare
 * integers, so `?status=accept_queue&pageSize=200` — the paging the export and
 * the deployed e2e suite both use — answered `400 VALIDATION` while the same
 * filters parsed fine from the server page, which happened to wrap them in
 * `Number(…)` by hand. These cases pin the query-string shape, which is the one
 * the route actually sees.
 */
describe("submissionFiltersSchema", () => {
  it("parses pagination out of a query string", () => {
    const filters = submissionFiltersSchema.parse({ status: "accept_queue", pageSize: "200", page: "2" });
    expect(filters).toMatchObject({ status: "accept_queue", page: 2, pageSize: 200 });
  });

  it("still parses numbers, so the server page's hand-parsed filters keep working", () => {
    expect(submissionFiltersSchema.parse({ page: 3, pageSize: 25 })).toMatchObject({ page: 3, pageSize: 25 });
  });

  it("defaults to the first page of 25 when neither is given", () => {
    expect(submissionFiltersSchema.parse({})).toMatchObject({ view: "all", status: "all", search: "", page: 1, pageSize: 25 });
  });

  it("still refuses a page size past the cap, a zero page and a non-number", () => {
    expect(() => submissionFiltersSchema.parse({ pageSize: "201" })).toThrow();
    expect(() => submissionFiltersSchema.parse({ page: "0" })).toThrow();
    expect(() => submissionFiltersSchema.parse({ page: "1.5" })).toThrow();
    expect(() => submissionFiltersSchema.parse({ pageSize: "many" })).toThrow();
  });

  it("refuses a status that is not a real tab", () => {
    expect(() => submissionFiltersSchema.parse({ status: "queued" })).toThrow();
  });
});

/**
 * The page reader is the lenient half of the same schema. A route rejects a bad
 * parameter because a program sent it; the Abstracts *page* gets its query
 * string from the address bar, where an organizer edits it and a stale bookmark
 * preserves it — and a `.parse` throw inside a server component is a 500 for
 * the whole surface, not a message about one word.
 */
describe("parseSubmissionFiltersForPage", () => {
  it("reads the filters a good URL carries", () => {
    expect(parseSubmissionFiltersForPage({ status: "pending", search: "agents", page: "3", sort: "title" }))
      .toMatchObject({ view: "needs_decision", status: "pending", search: "agents", page: 3, sort: "title" });
  });

  it("keeps old exact-status links and activates their containing workflow view", () => {
    expect(parseSubmissionFiltersForPage({ status: "accept_queue" })).toMatchObject({ view: "ready_to_notify", status: "accept_queue" });
    expect(parseSubmissionFiltersForPage({ view: "needs_decision", status: "declined" })).toMatchObject({ view: "decided", status: "declined" });
    expect(parseSubmissionFiltersForPage({ status: "withdrawn" })).toMatchObject({ view: "decided", status: "withdrawn" });
    expect(parseSubmissionFiltersForPage({ status: "draft" })).toMatchObject({ view: "all", status: "draft" });
  });

  it("treats an empty value as absent instead of 500ing on it", () => {
    // `?page=&search=` is what an emptied form or a hand-trimmed URL leaves
    // behind; `Number("")` is 0, which the positive-integer rule rejects.
    expect(parseSubmissionFiltersForPage({ page: "", search: "", status: "" }))
      .toMatchObject({ page: 1, search: "", status: "all" });
  });

  it("drops only the parameter it cannot read, keeping the rest", () => {
    expect(parseSubmissionFiltersForPage({ status: "accept_queue", sort: "loudest", page: "2" }))
      .toMatchObject({ status: "accept_queue", sort: "newest", page: 2 });
  });

  it("falls back to the default view when every parameter is unusable", () => {
    expect(parseSubmissionFiltersForPage({ status: "queued", page: "-4", pageSize: "5000" }))
      .toMatchObject({ status: "all", page: 1, pageSize: 25 });
  });

  it("takes the last value of a repeated parameter", () => {
    expect(parseSubmissionFiltersForPage({ status: ["pending", "declined"] })).toMatchObject({ status: "declined" });
  });

  it("ignores a parameter that is not a filter at all", () => {
    expect(parseSubmissionFiltersForPage({ tab: "anything", status: "draft" })).toMatchObject({ status: "draft" });
  });
});
