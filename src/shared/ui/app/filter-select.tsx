"use client";

import { Check, Search } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";

export type FilterSelectOption = {
  value: string;
  label: string;
  /** Secondary text — an email, a track, a room. Searched as well as shown. */
  hint?: string;
  /** Consecutive options sharing a group render under one heading. */
  group?: string;
};

type PopoverPosition = { top: number; left: number; width: number };
type Segment = { text: string; match: boolean };

const DIACRITIC = /\p{Diacritic}/gu;

/**
 * Folding is per-character so the folded string can be mapped back to the
 * original one index for index — which is what lets a match found in
 * "ürümqi" be highlighted in the label the organizer actually sees. A
 * whole-string `normalize()` cannot do that: decomposition and lowercasing
 * both change length, and a few characters (İ) change it by more than the
 * combining marks they shed.
 */
function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const piece = (text[index] ?? "").normalize("NFD").replace(DIACRITIC, "").toLowerCase();
    folded += piece;
    for (let offset = 0; offset < piece.length; offset += 1) origin.push(index);
  }
  return { folded, origin };
}

function foldForFilter(text: string): string {
  return fold(text).folded;
}

function filterTokens(query: string): string[] {
  return foldForFilter(query).split(/\s+/u).filter(Boolean);
}

/**
 * Every token has to appear somewhere in the option, but not in order and not
 * as one run: "ang los" finds Los Angeles, and "ada lovelace@" finds a speaker
 * by first name and email at once. Ranking then puts the options whose *label*
 * starts with what was typed above the ones that merely contain it, so the
 * obvious answer to "lon" is the first row rather than the alphabetically
 * lucky one. `sort` is stable, so options keep the caller's order within a
 * rank — an already-sorted list stays sorted.
 */
export function filterSelectOptions(
  options: readonly FilterSelectOption[],
  query: string,
): FilterSelectOption[] {
  const tokens = filterTokens(query);
  if (tokens.length === 0) return [...options];
  const phrase = tokens.join(" ");
  return options
    .map((option) => {
      const label = foldForFilter(option.label);
      const haystack = option.hint ? `${label} ${foldForFilter(option.hint)}` : label;
      if (!tokens.every((token) => haystack.includes(token))) return null;
      return { option, rank: label.startsWith(phrase) ? 0 : label.includes(phrase) ? 1 : 2 };
    })
    .filter((scored): scored is { option: FilterSelectOption; rank: number } => scored !== null)
    .sort((left, right) => left.rank - right.rank)
    .map((scored) => scored.option);
}

/** Splits a label into matched and unmatched runs so the popover can show *why* a row is there. */
export function highlightSegments(label: string, query: string): Segment[] {
  const tokens = filterTokens(query);
  if (tokens.length === 0) return label ? [{ text: label, match: false }] : [];
  const { folded, origin } = fold(label);
  const matched = new Array<boolean>(label.length).fill(false);
  for (const token of tokens) {
    for (let at = folded.indexOf(token); at !== -1; at = folded.indexOf(token, at + 1)) {
      for (let offset = 0; offset < token.length; offset += 1) {
        const index = origin[at + offset];
        if (index !== undefined) matched[index] = true;
      }
    }
  }
  const segments: Segment[] = [];
  for (let index = 0; index < label.length; index += 1) {
    const isMatch = matched[index] === true;
    const last = segments.at(-1);
    if (last && last.match === isMatch) last.text += label[index];
    else segments.push({ text: label[index] ?? "", match: isMatch });
  }
  return segments;
}

/** Which option the keyboard should land on after a move within the current matches. */
export function nextActiveValue(
  matches: readonly FilterSelectOption[],
  active: string | null,
  key: string,
): string | null {
  if (matches.length === 0) return null;
  const current = matches.findIndex((option) => option.value === active);
  const last = matches.length - 1;
  if (key === "Home") return matches[0]?.value ?? null;
  if (key === "End") return matches[last]?.value ?? null;
  const step = key === "ArrowUp" ? -1 : 1;
  // An unmatched active option (the filter just changed under it) resolves to
  // the nearer end rather than wrapping past the whole list.
  if (current === -1) return (step === 1 ? matches[0] : matches[last])?.value ?? null;
  return matches[Math.min(Math.max(current + step, 0), last)]?.value ?? null;
}

function positionPopover(anchor: DOMRect, popover: DOMRect): PopoverPosition {
  const gutter = 12;
  const gap = 6;
  const width = Math.min(Math.max(anchor.width, 220), window.innerWidth - gutter * 2);
  const left = Math.max(gutter, Math.min(anchor.left, window.innerWidth - width - gutter));
  const below = window.innerHeight - anchor.bottom - gap;
  const above = anchor.top - gap;
  const top = below >= popover.height || below >= above
    ? Math.min(anchor.bottom + gap, window.innerHeight - popover.height - gutter)
    : Math.max(gutter, anchor.top - popover.height - gap);
  return { top: Math.max(gutter, top), left, width };
}

/** Keep a list opened from a native modal in that dialog's top layer — the same bargain `DateTimePicker` strikes. */
function popoverContainer(root: HTMLElement | null): HTMLElement {
  return root?.closest<HTMLDialogElement>("dialog[open]") ?? document.body;
}

function groupRuns(matches: readonly FilterSelectOption[]): Array<{ label: string | null; options: FilterSelectOption[] }> {
  const runs: Array<{ label: string | null; options: FilterSelectOption[] }> = [];
  for (const option of matches) {
    const label = option.group ?? null;
    const last = runs.at(-1);
    if (last && last.label === label) last.options.push(option);
    else runs.push({ label, options: [option] });
  }
  return runs;
}

/**
 * The kit's *long* dropdown — the second primitive #115 asked for, beside
 * `Select`.
 *
 * `Select` is a native `<select>` on purpose, and for a dozen options that is
 * the right trade: the platform brings keyboard type-ahead, `Esc`, and the
 * touch picker for free. It stops being the right trade at the point where the
 * list is longer than the screen. A native popup of 400 timezones or 300
 * speakers has one line of type-ahead state, no substring search, no visible
 * feedback that anything was typed, and a scroll thumb the size of a hyphen —
 * the severity of an unsearchable list rises with its length until picking a
 * value is the slowest thing on the surface.
 *
 * So this one is application-owned, and it re-earns everything the native
 * element gave: type-ahead (typing from the closed control opens the list with
 * that first character already filtering), `Esc` to close leaving the value
 * untouched, arrow/Home/End navigation, and a control that a touch device can
 * open with one tap. What it adds is the reason it exists — substring search
 * across every option at once, with the matched run marked in each row so the
 * list explains itself.
 *
 * The closed state is deliberately the same box as `Select`: same height,
 * border, focus ring and chevron. Swapping a picker to this primitive must not
 * make it look like a *different kind of control* — only like one that can be
 * searched.
 *
 * `name` emits a hidden input so the control still posts with a form. Validity
 * is the caller's: the repo's forms report field errors themselves, and a
 * hidden input cannot carry `required`.
 */
export function FilterSelect({
  value,
  onChange,
  options,
  id,
  name,
  placeholder = "Select…",
  filterPlaceholder = "Type to filter…",
  emptyLabel = "No matches",
  disabled = false,
  required = false,
  invalid = false,
  ariaLabel,
  ariaDescribedBy,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly FilterSelectOption[];
  id?: string;
  name?: string;
  placeholder?: string;
  filterPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const uid = useId().replaceAll(":", "");
  const listboxId = `filter-select-${uid}-list`;
  const statusId = `filter-select-${uid}-status`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const matches = useMemo(() => filterSelectOptions(options, query), [options, query]);
  const runs = useMemo(() => groupRuns(matches), [matches]);
  const activeId = active === null ? undefined : `${listboxId}-${matches.findIndex((option) => option.value === active)}`;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPosition(null);
    setQuery("");
    if (restoreFocus) inputRef.current?.focus();
  }, []);

  const openList = useCallback((seed: string) => {
    if (disabled) return;
    setQuery(seed);
    setActive(seed ? null : value || null);
    setOpen(true);
  }, [disabled, value]);

  const placePopover = useCallback(() => {
    const anchor = rootRef.current?.getBoundingClientRect();
    const popover = popoverRef.current?.getBoundingClientRect();
    if (anchor && popover) setPosition(positionPopover(anchor, popover));
  }, []);

  // The active option follows the filter: whatever is typed, Enter always has
  // something obvious to commit, and it is never a row that scrolled out of
  // the result set two keystrokes ago.
  useEffect(() => {
    if (!open) return;
    setActive((current) => matches.some((option) => option.value === current) ? current : matches[0]?.value ?? null);
  }, [matches, open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(placePopover);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // `preventDefault` so an open list inside a `Modal` swallows the first
      // Escape instead of closing the dialog under it and losing the edit.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close, open, placePopover]);

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (disabled && open) close(false);
  }, [close, disabled, open]);

  function choose(option: FilterSelectOption) {
    onChange(option.value);
    close(true);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        openList("");
        return;
      }
      setActive(nextActiveValue(matches, active, event.key));
      return;
    }
    if (event.key === "Enter") {
      if (!open) {
        event.preventDefault();
        openList("");
        return;
      }
      const option = matches.find((match) => match.value === active);
      // Never let Enter reach an enclosing form: the list is open, so Enter
      // means "take this option", not "save".
      event.preventDefault();
      if (option) choose(option);
      return;
    }
    if (event.key === "Tab" && open) {
      close(false);
      return;
    }
    if (open) return;
    // Everything below is the closed control, where the input is showing the
    // selected option's *label* rather than a query. Each of these keys would
    // otherwise edit that label into nonsense, so none of them reach the input:
    // they open the list instead, which is what the person meant.
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      openList("");
      return;
    }
    // Type-ahead, the one habit the native element taught — except Space, which
    // opens the whole list the way it does on a `<select>` rather than
    // filtering by a blank.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openList(event.key === " " ? "" : event.key);
    }
  }

  const popover = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={popoverRef}
      className="filter-select-popover"
      style={position ? { ...position } : { visibility: "hidden", top: 0, left: 0, width: 220 }}
    >
      <div className="filter-select-list" role="listbox" id={listboxId} aria-label={ariaLabel ?? placeholder}>
        {runs.map((run, runIndex) => {
          const rows = run.options.map((option) => {
            const index = matches.indexOf(option);
            const isActive = option.value === active;
            return (
              <div
                key={option.value}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-active={isActive || undefined}
                className={cn("filter-select-option", isActive && "is-active", option.value === value && "is-selected")}
                // Keep focus on the combobox so `aria-activedescendant` stays
                // the single source of truth for where the keyboard is.
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => setActive(option.value)}
                onClick={() => choose(option)}
              >
                <Check size={14} aria-hidden="true" className="filter-select-check" />
                <span>
                  {highlightSegments(option.label, query).map((segment, at) => segment.match
                    ? <mark key={at}>{segment.text}</mark>
                    : <span key={at}>{segment.text}</span>)}
                </span>
                {option.hint && <small>{option.hint}</small>}
              </div>
            );
          });
          return run.label === null
            ? <Fragment key={`run-${runIndex}`}>{rows}</Fragment>
            : <div key={`run-${runIndex}`} role="group" aria-label={run.label} className="filter-select-group">
              <div className="filter-select-group-label" aria-hidden="true">{run.label}</div>
              {rows}
            </div>;
        })}
      </div>
      {matches.length === 0 && <p className="filter-select-empty">{emptyLabel}</p>}
    </div>,
    popoverContainer(rootRef.current),
  ) : null;

  return <>
    <div
      ref={rootRef}
      className={cn("filter-select", open && "is-open", invalid && "is-invalid", disabled && "is-disabled", className)}
      // The chevron and the padding around the value are part of the control,
      // not decoration beside it: a pointer aimed at the arrow has to open the
      // list, the way it does on a `<select>`. A pointer aimed at the input
      // keeps the browser's own default, so focus — and, on a phone, the
      // keyboard — arrives with the same tap that opened the list.
      onMouseDown={(event) => {
        if (disabled || open) return;
        openList("");
        if (event.target === inputRef.current) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <Search size={15} aria-hidden="true" className="filter-select-icon" />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? activeId : undefined}
        value={open ? query : (selected?.label ?? "")}
        placeholder={open ? (selected?.label ?? filterPlaceholder) : placeholder}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onInputKeyDown}
        // Pasting an address into a closed picker means "find this person",
        // not "rewrite the label of the one already chosen".
        onPaste={(event) => {
          if (open) return;
          event.preventDefault();
          openList(event.clipboardData.getData("text").trim());
        }}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </div>
    {/* Counted out loud, because on this control the filter is the interaction:
        a screen-reader user who types four characters has to hear whether the
        list narrowed to three rows or to none. */}
    <span id={statusId} className="sr-only" role="status">
      {open ? `${matches.length} ${matches.length === 1 ? "option" : "options"}` : ""}
    </span>
    {popover}
  </>;
}
