import { describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/features/shell/server/search";
import {
  COMMAND_PALETTE_SEARCH_ERROR,
  commandPaletteSearchFeedback,
  searchResultHint,
  idleCommandPaletteSearch,
  loadingCommandPaletteSearch,
  settleCommandPaletteSearch,
  type CommandPaletteSearchState,
} from "./command-palette-search";

function result(id: string, label: string): SearchResult {
  return {
    type: "speaker",
    id,
    label,
    sublabel: `${label.toLowerCase()}@example.com`,
    status: null,
    href: `/speakers/${id}`,
  };
}

describe("command palette result hints", () => {
  it("names a status in the app's vocabulary, never the raw column value", () => {
    expect(searchResultHint("Submission", { sublabel: "SESS-42", status: "accept_queue" }))
      .toBe("Submission · SESS-42 · Queued to accept");
    expect(searchResultHint("Session", { sublabel: null, status: "published" })).toBe("Session · Published");
  });

  it("drops the parts a result does not have", () => {
    expect(searchResultHint("Speaker", { sublabel: "ada@example.com", status: null }))
      .toBe("Speaker · ada@example.com");
    expect(searchResultHint("Speaker", { sublabel: null, status: null })).toBe("Speaker");
  });
});

function deferredResponse() {
  let resolve: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((complete) => { resolve = complete; });
  return { promise, resolve: (response: Response) => resolve?.(response) };
}

describe("command palette search settlement", () => {
  it("publishes an empty response as a successful search rather than a failure", async () => {
    const onSettled = vi.fn<(state: CommandPaletteSearchState) => void>();

    await settleCommandPaletteSearch({
      eventId: "event-1",
      term: "nobody",
      signal: new AbortController().signal,
      isCurrent: () => true,
      onSettled,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] })),
    });

    expect(onSettled).toHaveBeenCalledWith({ status: "success", term: "nobody", results: [] });
  });

  it("does not let an older response overwrite the newest search", async () => {
    const older = deferredResponse();
    const newer = deferredResponse();
    const fetcher = vi.fn<typeof fetch>()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const onSettled = vi.fn<(state: CommandPaletteSearchState) => void>();
    let currentRequest = 1;

    const oldSearch = settleCommandPaletteSearch({
      eventId: "event-1",
      term: "al",
      signal: new AbortController().signal,
      isCurrent: () => currentRequest === 1,
      onSettled,
      fetcher,
    });
    currentRequest = 2;
    const newSearch = settleCommandPaletteSearch({
      eventId: "event-1",
      term: "alex",
      signal: new AbortController().signal,
      isCurrent: () => currentRequest === 2,
      onSettled,
      fetcher,
    });

    newer.resolve(Response.json({ data: [result("new", "Alex New")] }));
    await newSearch;
    older.resolve(Response.json({ data: [result("old", "Al Old")] }));
    await oldSearch;

    expect(onSettled).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledWith({
      status: "success",
      term: "alex",
      results: [result("new", "Alex New")],
    });
  });

  it("ignores AbortError instead of announcing a failed search", async () => {
    const onSettled = vi.fn<(state: CommandPaletteSearchState) => void>();

    await settleCommandPaletteSearch({
      eventId: "event-1",
      term: "alex",
      signal: new AbortController().signal,
      isCurrent: () => true,
      onSettled,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new DOMException("superseded", "AbortError")),
    });

    expect(onSettled).not.toHaveBeenCalled();
  });

  it("publishes a retryable error when the network request fails", async () => {
    const onSettled = vi.fn<(state: CommandPaletteSearchState) => void>();

    await settleCommandPaletteSearch({
      eventId: "event-1",
      term: "alex",
      signal: new AbortController().signal,
      isCurrent: () => true,
      onSettled,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection lost")),
    });

    expect(onSettled).toHaveBeenCalledWith({
      status: "error",
      term: "alex",
      results: [],
      message: COMMAND_PALETTE_SEARCH_ERROR,
    });
  });

  it.each([
    ["HTTP failure", new Response(null, { status: 503 })],
    ["malformed success", Response.json({ unexpected: [] })],
  ])("publishes a retryable error for a genuine %s", async (_label, response) => {
    const onSettled = vi.fn<(state: CommandPaletteSearchState) => void>();

    await settleCommandPaletteSearch({
      eventId: "event-1",
      term: "alex",
      signal: new AbortController().signal,
      isCurrent: () => true,
      onSettled,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    expect(onSettled).toHaveBeenCalledWith({
      status: "error",
      term: "alex",
      results: [],
      message: COMMAND_PALETTE_SEARCH_ERROR,
    });
  });
});

describe("command palette search feedback", () => {
  it("distinguishes idle, loading, empty success, populated success, and retryable error", () => {
    expect(commandPaletteSearchFeedback(idleCommandPaletteSearch("x"), 0)).toEqual({
      message: "Keep typing to search speakers, submissions, and sessions.",
      visible: true,
      retry: false,
    });
    expect(commandPaletteSearchFeedback(loadingCommandPaletteSearch("alex"), 0)).toEqual({
      message: "Searching for “alex”…",
      visible: true,
      retry: false,
    });
    expect(commandPaletteSearchFeedback({ status: "success", term: "alex", results: [] }, 0)).toEqual({
      message: "No results for “alex”.",
      visible: true,
      retry: false,
    });
    expect(commandPaletteSearchFeedback({ status: "success", term: "alex", results: [result("1", "Alex")] }, 1)).toEqual({
      message: "1 option available.",
      visible: false,
      retry: false,
    });
    expect(commandPaletteSearchFeedback({
      status: "error",
      term: "alex",
      results: [],
      message: COMMAND_PALETTE_SEARCH_ERROR,
    }, 0)).toEqual({
      message: COMMAND_PALETTE_SEARCH_ERROR,
      visible: true,
      retry: true,
    });
  });

  it("does not promise entity results to a palette that has none", () => {
    // The verbs-only (reviewer) palette. "Keep typing to search speakers,
    // submissions, and sessions" would be an invitation to wait for results
    // that are never coming.
    expect(commandPaletteSearchFeedback(idleCommandPaletteSearch("zzz"), 0, { entitySearch: false })).toEqual({
      message: "No commands match \u201Czzz\u201D.",
      visible: true,
      retry: false,
    });
  });
});
