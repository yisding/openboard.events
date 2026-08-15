import type { SearchResult } from "@/features/shell/server/search";
import { STATUS_BADGES, type StatusBadgeValue } from "@/shared/ui/status-badge";

export const COMMAND_PALETTE_SEARCH_ERROR = "Search could not be completed. Check your connection and try again.";

export type CommandPaletteSearchState =
  | { status: "idle"; term: string; results: SearchResult[] }
  | { status: "loading"; term: string; results: SearchResult[] }
  | { status: "success"; term: string; results: SearchResult[] }
  | { status: "error"; term: string; results: SearchResult[]; message: string };

/**
 * The secondary line under a result: what kind of row it is, what identifies
 * it, and what state it is in. The status arrives as the column holds it, so
 * the words come from the one authored vocabulary the badges also render —
 * "Queued to accept", never `accept_queue`.
 */
export function searchResultHint(kind: string, result: Pick<SearchResult, "sublabel" | "status">): string {
  const status = result.status === null
    ? null
    : STATUS_BADGES[result.status as StatusBadgeValue]?.label ?? result.status.replace(/_/gu, " ");
  return [kind, result.sublabel, status].filter(Boolean).join(" · ");
}

export function idleCommandPaletteSearch(term = ""): CommandPaletteSearchState {
  return { status: "idle", term, results: [] };
}

export function loadingCommandPaletteSearch(term: string): CommandPaletteSearchState {
  return { status: "loading", term, results: [] };
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/**
 * Settles one palette request only when it is still the newest request.
 * Fetch aborts are an expected effect cleanup, not a failed search.
 */
export async function settleCommandPaletteSearch({
  eventId,
  term,
  signal,
  isCurrent,
  onSettled,
  fetcher = fetch,
}: {
  eventId: string;
  term: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
  onSettled: (state: CommandPaletteSearchState) => void;
  fetcher?: typeof fetch;
}): Promise<void> {
  try {
    const response = await fetcher(`/api/internal/events/${eventId}/search?q=${encodeURIComponent(term)}`, { signal });
    if (!response.ok) throw new Error("Search request failed");

    const payload = await response.json() as unknown;
    if (
      typeof payload !== "object"
      || payload === null
      || !("data" in payload)
      || !Array.isArray(payload.data)
    ) {
      throw new Error("Search response was invalid");
    }
    if (!isCurrent()) return;
    onSettled({ status: "success", term, results: payload.data as SearchResult[] });
  } catch (error) {
    if (isAbortError(error) || !isCurrent()) return;
    onSettled({ status: "error", term, results: [], message: COMMAND_PALETTE_SEARCH_ERROR });
  }
}

/**
 * `entitySearch: false` is the verbs-only palette a reviewer gets. The idle
 * copy has to change with it: "Keep typing to search speakers, submissions, and
 * sessions" is an invitation to wait for results that are never coming.
 */
export function commandPaletteSearchFeedback(
  state: CommandPaletteSearchState,
  itemCount: number,
  { entitySearch = true }: { entitySearch?: boolean } = {},
): { message: string; visible: boolean; retry: boolean } {
  if (state.status === "loading") {
    return { message: `Searching for “${state.term}”…`, visible: true, retry: false };
  }
  if (state.status === "error") {
    return { message: state.message, visible: true, retry: true };
  }
  if (state.status === "success") {
    return itemCount === 0
      ? { message: `No results for “${state.term}”.`, visible: true, retry: false }
      : { message: `${itemCount} ${itemCount === 1 ? "option" : "options"} available.`, visible: false, retry: false };
  }
  if (state.term) {
    if (itemCount > 0) {
      return { message: `${itemCount} matching ${itemCount === 1 ? "command" : "commands"} available.`, visible: false, retry: false };
    }
    return entitySearch
      ? { message: "Keep typing to search speakers, submissions, and sessions.", visible: true, retry: false }
      : { message: `No commands match “${state.term}”.`, visible: true, retry: false };
  }
  return { message: `${itemCount} ${itemCount === 1 ? "command is" : "commands are"} ready.`, visible: false, retry: false };
}
