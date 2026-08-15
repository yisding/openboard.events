"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ClipboardCheck, Search, Sparkles, Users, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MemberRole } from "@/shared/contracts";
import { isSameNavigationDestination, useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import type { SearchResult, SearchResultType } from "@/features/shell/server/search";
import { emojiRain } from "@/shared/ui/emoji-rain";
import { useToast } from "@/shared/ui/toast";
import {
  commandPaletteSearchFeedback,
  idleCommandPaletteSearch,
  loadingCommandPaletteSearch,
  settleCommandPaletteSearch,
  type CommandPaletteSearchState,
} from "./command-palette-search";

/**
 * M58 — the shell's "Search anything ⌘K" trigger, made real. Two kinds of
 * entry share one keyboard-navigable list: fixed verbs (filtered client-side
 * by label, always available) and live entity results (fetched once the
 * query is long enough to be worth a request). experience-design.md's
 * "Fewer steps" §1: the palette is the road, the sidebar stays the map.
 */
type Verb = { id: string; label: string; hint: string; href: string };

function verbsForRole(base: string, role: MemberRole): Verb[] {
  if (role === "reviewer") {
    return [
      { id: "review-queue", label: "Go to my review queue", hint: "Review", href: `${base}/review` },
    ];
  }
  return [
    // "arm=1" is `DataTable`'s `selectAllEpoch` trigger, read by the target
    // view — the bulk bar is already showing a count and its actions the
    // moment the list renders, not after a manual select-all.
    { id: "abstracts-pending", label: "Decide pending submissions…", hint: "Submissions", href: `${base}/abstracts?status=pending&arm=1` },
    { id: "speakers-missing", label: "Email speakers missing bio or headshot…", hint: "Speakers", href: `${base}/speakers?missing=either&arm=1` },
    { id: "assign-reviewers", label: "Assign reviewers…", hint: "Evaluation", href: `${base}/evaluation` },
    { id: "unscheduled", label: "Schedule unscheduled sessions", hint: "Agenda", href: `${base}/agenda?view=day` },
    { id: "communications", label: "Review recent communications", hint: "Communications", href: `${base}/communications` },
  ];
}

const RESULT_ICON: Record<SearchResultType, LucideIcon> = {
  submission: ClipboardCheck,
  speaker: Users,
  session: CalendarDays,
};

const RESULT_LABEL: Record<SearchResultType, string> = {
  submission: "Submission",
  speaker: "Speaker",
  session: "Session",
};

type PaletteItem = { key: string; icon: LucideIcon; label: string; hint: string; href: string };

// Easter eggs: everyone types something silly into a new command palette
// sooner or later, and the classics should be rewarded. Each egg's item only
// appears for a matching query, so the real verbs and results never share the
// list with it uninvited — and choosing one celebrates in place instead of
// navigating anywhere.
type PaletteEgg = { item: PaletteItem; terms: readonly string[]; emojis: string[]; toast: string };

const PALETTE_EGGS: readonly PaletteEgg[] = [
  { item: { key: "egg:pandas", icon: Sparkles, label: "Release the pandas", hint: "???", href: "" }, terms: ["panda", "🐼"], emojis: ["🐼", "🎋", "✨"], toast: "The pandas are loose. Nothing else ships for the next four seconds. 🐼" },
  { item: { key: "egg:tiger", icon: Sparkles, label: "Unleash the tiger", hint: "???", href: "" }, terms: ["tiger", "🐯", "🐅"], emojis: ["🐯", "🐅", "✨"], toast: "A tiger now prowls the venue. Grrreat talks only from here on out. 🐯" },
  { item: { key: "egg:afterparty", icon: Sparkles, label: "Start the afterparty", hint: "???", href: "" }, terms: ["party", "confetti", "disco", "🎉", "🪩"], emojis: ["🪩", "🎉", "🎊", "✨"], toast: "Afterparty unlocked. The hallway track is now the main stage. 🪩" },
  { item: { key: "egg:espresso", icon: Sparkles, label: "Brew a committee espresso", hint: "???", href: "" }, terms: ["coffee", "espresso", "☕"], emojis: ["☕", "🥐", "✨"], toast: "Fresh pot for the program committee. Decisions per minute: doubled. ☕" },
];

/** The eggs a query summons — exported pure so the secret menu stays testable. */
export function paletteEggsForQuery(query: string): PaletteItem[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return PALETTE_EGGS.filter((egg) => egg.terms.some((trigger) => term.includes(trigger))).map((egg) => egg.item);
}

function toItems(verbs: Verb[], results: SearchResult[]): PaletteItem[] {
  return [
    ...verbs.map((verb) => ({ key: `verb:${verb.id}`, icon: Zap, label: verb.label, hint: verb.hint, href: verb.href })),
    ...results.map((result) => ({ key: `${result.type}:${result.id}`, icon: RESULT_ICON[result.type], label: result.label, hint: result.sublabel ? `${RESULT_LABEL[result.type]} · ${result.sublabel}` : RESULT_LABEL[result.type], href: result.href })),
  ];
}

export function PaletteDialog({ eventId, base, role, onClose }: { eventId: string; base: string; role: MemberRole; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const { runGuarded, allowNextNavigation } = useGuardedAction();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const searchStatusId = useId();
  const searchRequest = useRef(0);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<CommandPaletteSearchState>(() => idleCommandPaletteSearch());
  const [retryEpoch, setRetryEpoch] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  const verbs = useMemo(() => verbsForRole(base, role), [base, role]);
  const filteredVerbs = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? verbs.filter((verb) => verb.label.toLowerCase().includes(term)) : verbs;
  }, [verbs, query]);

  // Debounced — every keystroke firing a request against the event's
  // submissions/contacts/sessions would be wasteful and would race itself;
  // 150ms is short enough to still feel instant.
  useEffect(() => {
    const term = query.trim();
    const requestId = searchRequest.current + 1;
    searchRequest.current = requestId;
    if (term.length < 2) {
      setSearchState(idleCommandPaletteSearch(term));
      return;
    }
    // Results from the previous term must never remain keyboard-selectable
    // while the next debounced request is in flight.
    setSearchState(loadingCommandPaletteSearch(term));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void settleCommandPaletteSearch({
        eventId,
        term,
        signal: controller.signal,
        isCurrent: () => searchRequest.current === requestId,
        onSettled: setSearchState,
      });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (searchRequest.current === requestId) searchRequest.current += 1;
    };
  }, [query, eventId, retryEpoch]);

  const term = query.trim();
  // Effects run after render. Derive the pending state synchronously so the
  // previous term's results disappear before they can be selected.
  const currentSearchState = searchState.term === term
    ? searchState
    : term.length >= 2 ? loadingCommandPaletteSearch(term) : idleCommandPaletteSearch(term);

  const items = useMemo(() => {
    const list = toItems(filteredVerbs, currentSearchState.results);
    list.push(...paletteEggsForQuery(query));
    return list;
  }, [filteredVerbs, currentSearchState.results, query]);
  const activeOptionId = items[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined;
  useEffect(() => setActiveIndex(0), [items.length]);
  const feedback = commandPaletteSearchFeedback(currentSearchState, items.length);

  function go(item: PaletteItem) {
    const egg = PALETTE_EGGS.find((candidate) => candidate.item.key === item.key);
    if (egg) {
      emojiRain(egg.emojis);
      toast(egg.toast);
      onClose();
      return;
    }
    if (isSameNavigationDestination(item.href, window.location.href)) {
      onClose();
      return;
    }
    runGuarded(() => allowNextNavigation(() => {
      router.push(item.href);
      onClose();
    }, { destination: item.href }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // Keep dismissal explicit instead of relying solely on the native
      // dialog cancel event. Browser/React combinations do not all dispatch
      // that event consistently from a focused combobox.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    // Arrow/result navigation belongs to the combobox. Let buttons keep their
    // native keyboard activation when focus has moved into the palette UI.
    if (event.target !== inputRef.current) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) go(item);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="command-palette-shell"
      aria-label="Search anything"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <div className="command-palette" onKeyDown={onKeyDown}>
        <div className="command-palette-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a speaker, submission or session… or run a command"
            aria-label="Search anything"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-describedby={searchStatusId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
          />
          <button type="button" className="command-palette-close" aria-label="Close search" onClick={onClose}>
            <kbd>Esc</kbd>
          </button>
        </div>
        <div
          id={searchStatusId}
          className={`command-palette-feedback${feedback.visible ? "" : " sr-only"}${currentSearchState.status === "error" ? " command-palette-feedback-error" : ""}`}
          role={currentSearchState.status === "error" ? "alert" : "status"}
          aria-live={currentSearchState.status === "error" ? "assertive" : "polite"}
        >
          <span>{feedback.message}</span>
          {feedback.retry && <button type="button" onClick={() => setRetryEpoch((epoch) => epoch + 1)}>Retry search</button>}
        </div>
        <div className="command-palette-results" role="listbox" id={listboxId} aria-busy={currentSearchState.status === "loading"}>
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : ""}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => go(item)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}

export function CommandPalette({ eventId, base, role }: { eventId: string; base: string; role: MemberRole }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // The dialog unmounts with the state update. Queue focus restoration after
    // that commit so keyboard users land back on the control that opened it.
    globalThis.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // The global ⌘K/Ctrl+K listener lives at the top level (not inside the
  // dialog) so it fires from anywhere in the shell, matching the topbar
  // button's promise regardless of which surface has focus.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button ref={triggerRef} type="button" className="search-trigger" aria-label="Search anything" onClick={() => setOpen(true)}>
        <Search size={17} /><span>Search anything</span><kbd>⌘ K</kbd>
      </button>
      {open && <PaletteDialog eventId={eventId} base={base} role={role} onClose={close} />}
    </>
  );
}
