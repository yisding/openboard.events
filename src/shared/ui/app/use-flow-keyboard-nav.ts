"use client";

import { useEffect } from "react";

/**
 * The pure step: which id is "next" or "prev" from `activeId` in `ids`, or
 * `undefined` at either end (no wrapping — a drawer's next/prev is a walk
 * through the list on screen, not a carousel). Split out from the keydown
 * listener below so the one thing worth a unit test can have one without a
 * DOM.
 */
export function nextFlowId(ids: readonly string[], activeId: string, direction: "next" | "prev"): string | undefined {
  const index = ids.indexOf(activeId);
  if (index === -1) return undefined;
  return ids[direction === "next" ? index + 1 : index - 1];
}

/**
 * M57 — keyboard next/prev for a slide-over opened over a list (the list
 * itself stays visible behind it). While `activeId` is non-null:
 * - ArrowDown / `j` moves to the next id in `ids`, ArrowUp / `k` to the
 *   previous one (`j`/`k` mirrors the reviewer queue's own existing
 *   shortcut, `ReviewQueueView`'s `n`-to-advance convention's nearest
 *   two-directional analogue).
 * - Escape closes, unless an open native <dialog> is already going to raise its
 *   own close request for the same keystroke.
 *
 * Typing in an input, textarea, select or contenteditable region (the rich
 * text editor a submission's Details panel can hold) is never hijacked —
 * every one of those is a legitimate place to type the letters j/k or press
 * an arrow key while editing.
 */
export function useFlowKeyboardNav({
  ids,
  activeId,
  onNavigate,
  onClose,
}: {
  ids: readonly string[];
  activeId: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (activeId === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === "Escape") {
        // Every overlay this hook drives is a native <dialog>, which raises its
        // own close request for Escape. Answering the keystroke here as well ran
        // the caller's `onClose` twice: this listener's state update flushed
        // before the browser dispatched the close request, so an unsaved-work
        // confirmation opened *into* that request and was dismissed by the very
        // keystroke that raised it — Escape looked dead on a dirty drawer while
        // the Close button worked. The top-most open dialog owns the key.
        if (document.querySelector("dialog[open]")) return;
        onClose();
        return;
      }
      const isNext = event.key === "ArrowDown" || event.key === "j";
      const isPrev = event.key === "ArrowUp" || event.key === "k";
      if (!isNext && !isPrev) return;
      const nextId = nextFlowId(ids, activeId as string, isNext ? "next" : "prev");
      if (!nextId) return;
      event.preventDefault();
      onNavigate(nextId);
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [ids, activeId, onNavigate, onClose]);
}
