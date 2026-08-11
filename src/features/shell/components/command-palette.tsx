"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ClipboardCheck, Search, Users, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MemberRole } from "@/shared/contracts";
import type { SearchResult, SearchResultType } from "@/features/shell/server/search";

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
    { id: "abstracts-pending", label: "Decide pending abstracts…", hint: "Abstracts", href: `${base}/abstracts?status=pending&arm=1` },
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

function toItems(verbs: Verb[], results: SearchResult[]): PaletteItem[] {
  return [
    ...verbs.map((verb) => ({ key: `verb:${verb.id}`, icon: Zap, label: verb.label, hint: verb.hint, href: verb.href })),
    ...results.map((result) => ({ key: `${result.type}:${result.id}`, icon: RESULT_ICON[result.type], label: result.label, hint: result.sublabel ? `${RESULT_LABEL[result.type]} · ${result.sublabel}` : RESULT_LABEL[result.type], href: result.href })),
  ];
}

function PaletteDialog({ eventId, base, role, onClose }: { eventId: string; base: string; role: MemberRole; onClose: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    inputRef.current?.focus();
    return () => dialog.close();
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
    if (term.length < 2) {
      setResults([]);
      return;
    }
    // Results from the previous term must never remain keyboard-selectable
    // while the next debounced request is in flight.
    setResults([]);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/internal/events/${eventId}/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("search failed")))
        .then((payload: { data?: SearchResult[] }) => setResults(payload.data ?? []))
        .catch(() => setResults([]));
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, eventId]);

  const items = useMemo(() => toItems(filteredVerbs, results), [filteredVerbs, results]);
  useEffect(() => setActiveIndex(0), [items.length]);

  function go(item: PaletteItem) {
    router.push(item.href);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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

  const showingResults = query.trim().length >= 2;

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
            aria-controls="command-palette-listbox"
            aria-autocomplete="list"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-results" role="listbox" id="command-palette-listbox">
          {items.length === 0 && (
            <p className="command-palette-empty">{showingResults ? "Nothing matches" : "No matching commands"}</p>
          )}
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
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
      <button type="button" className="search-trigger" onClick={() => setOpen(true)}>
        <Search size={17} /><span>Search anything</span><kbd>⌘ K</kbd>
      </button>
      {open && <PaletteDialog eventId={eventId} base={base} role={role} onClose={() => setOpen(false)} />}
    </>
  );
}
