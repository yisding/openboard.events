"use client";

import { Sparkles } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { emojiRain } from "@/shared/ui/emoji-rain";

/**
 * First-run hints — small pulsing beacons over UI a first-time organizer may
 * not have found yet. Deliberately ambient rather than a step-by-step tour:
 * every beacon is optional, opens only when clicked, and disappears forever
 * once acknowledged ("Got it") or when the organizer opts out of the whole
 * set ("Skip all tips"). The same rules `MilestoneBanner` established apply:
 *
 *   - Seen-state lives in localStorage under the `openboard:` prefix, read on
 *     mount, never during render — the server pass and the first client pass
 *     both draw nothing, so there is no hydration mismatch and no beacon
 *     flash for an organizer who dismissed everything months ago.
 *   - The popover renders through a portal because the natural anchors
 *     (sidebar rows, the topbar) live inside overflow and backdrop-filter
 *     containers that would clip or re-root an absolutely positioned card.
 *
 * "Skip all" writes one scoped key rather than one key per hint, so hints
 * added later stay hidden for someone who already said "not interested".
 */

export type HintPlacement = "right" | "bottom" | "bottom-end";

const POPOVER_WIDTH = 264;
/* A conservative estimate of the tallest card, used only to keep the fixed
   popover from opening past the bottom viewport edge. */
const POPOVER_CLEARANCE = 190;
const EDGE_MARGIN = 12;

export function hintSkipKey(scope: string): string {
  return `openboard:hints-skipped:${scope}`;
}

export function hintStorageKey(id: string): string {
  return `openboard:hint-seen:${id}`;
}

/**
 * Which hints in `ids` the organizer has already dealt with. On the server
 * (and in node tests) everything counts as seen: the safe answer when there
 * is no storage to consult is "show nothing".
 */
export function readSeenHintIds(scope: string, ids: readonly string[]): Set<string> {
  if (typeof window === "undefined") return new Set(ids);
  if (window.localStorage.getItem(hintSkipKey(scope)) === "1") return new Set(ids);
  const seen = new Set<string>();
  for (const id of ids) {
    if (window.localStorage.getItem(hintStorageKey(id)) === "1") seen.add(id);
  }
  return seen;
}

/** Forget a scope's hints so its beacons show again — the kitchen sink's reset. */
export function resetHints(scope: string, ids: readonly string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(hintSkipKey(scope));
  for (const id of ids) window.localStorage.removeItem(hintStorageKey(id));
}

type ViewportSize = { width: number; height: number };
type AnchorRect = { top: number; right: number; bottom: number; left: number };

/**
 * Fixed-position style for the popover, measured from the beacon at the
 * moment it opens. Pure so the clamping is testable; the caller closes the
 * popover on scroll/resize rather than re-measuring.
 */
export function hintPopoverPosition(placement: HintPlacement, anchor: AnchorRect, viewport: ViewportSize): CSSProperties {
  const clampLeft = (left: number) => Math.min(Math.max(EDGE_MARGIN, left), Math.max(EDGE_MARGIN, viewport.width - POPOVER_WIDTH - EDGE_MARGIN));
  const clampTop = (top: number) => Math.min(Math.max(EDGE_MARGIN, top), Math.max(EDGE_MARGIN, viewport.height - POPOVER_CLEARANCE));
  if (placement === "right") return { left: clampLeft(anchor.right + 10), top: clampTop(anchor.top - 8) };
  if (placement === "bottom-end") return { left: clampLeft(anchor.right - POPOVER_WIDTH), top: clampTop(anchor.bottom + 10) };
  return { left: clampLeft(anchor.left), top: clampTop(anchor.bottom + 10) };
}

type HintsContextValue = {
  ids: readonly string[];
  seen: Set<string> | null;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

const HintsContext = createContext<HintsContextValue | null>(null);

export function FirstRunHints({ scope, ids, children }: { scope: string; ids: readonly string[]; children: ReactNode }) {
  // null until the mount effect reads storage: both server and first client
  // render draw no beacons, which is what keeps hydration honest.
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setSeen(readSeenHintIds(scope, ids)), [scope, ids]);

  const value = useMemo<HintsContextValue>(() => ({
    ids,
    seen,
    openId,
    setOpenId,
    dismiss(id) {
      window.localStorage.setItem(hintStorageKey(id), "1");
      setOpenId(null);
      setSeen((current) => new Set(current).add(id));
      // Acknowledging the last tip earns a two-second sparkle — the same
      // self-cleaning overlay the palette's panda egg uses, and like it, a
      // no-op under prefers-reduced-motion. "Skip all" stays silent on
      // purpose: opting out is not a celebration.
      if (seen !== null && ids.every((other) => other === id || seen.has(other))) emojiRain(["✨"], 14);
    },
    dismissAll() {
      window.localStorage.setItem(hintSkipKey(scope), "1");
      setOpenId(null);
      setSeen(new Set(ids));
    },
  }), [ids, openId, scope, seen]);

  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>;
}

/**
 * Wraps the UI the tip points at. Renders its children untouched plus, while
 * the hint is unseen, a beacon button; the tip card itself portals to
 * `document.body`. Outside a `FirstRunHints` provider (or for an id the
 * provider does not list, e.g. a reviewer's shell) it renders children only.
 */
export function Hint({ id, title, body, placement = "bottom", block, className, children }: {
  id: string;
  title: string;
  body: string;
  placement?: HintPlacement;
  /** Block anchor for full-width targets like sidebar rows; inline-flex otherwise. */
  block?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const context = useContext(HintsContext);
  const beaconRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  const known = context !== null && context.ids.includes(id);
  const visible = known && context.seen !== null && !context.seen.has(id);
  const open = visible && context.openId === id;
  const setOpenId = context?.setOpenId;

  useEffect(() => {
    if (!open || !setOpenId) return;
    confirmRef.current?.focus({ preventScroll: true });
    function close(refocus: boolean) {
      setOpenId?.(null);
      if (refocus) beaconRef.current?.focus({ preventScroll: true });
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(true);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || beaconRef.current?.contains(target)) return;
      close(false);
    }
    // The card is fixed and measured once, so any scroll or resize would
    // strand it away from its anchor — closing is the honest response.
    function onDrift() {
      close(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onDrift, true);
    window.addEventListener("resize", onDrift);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onDrift, true);
      window.removeEventListener("resize", onDrift);
    };
  }, [open, setOpenId]);

  if (!context) return <>{children}</>;

  function toggle() {
    if (!context) return;
    if (open) {
      context.setOpenId(null);
      return;
    }
    const rect = beaconRef.current?.getBoundingClientRect();
    if (rect) setPosition(hintPopoverPosition(placement, rect, { width: window.innerWidth, height: window.innerHeight }));
    context.setOpenId(id);
  }

  const order = Math.max(0, context.ids.indexOf(id));
  const titleId = `hint-${id.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  // A block anchor is a <div> rather than a styled span: sidebar containers
  // style their direct-child <span>s as group labels (uppercase, faint), and
  // that text-transform would inherit into the wrapped row.
  const Anchor = block ? "div" : "span";
  return (
    <Anchor className={cn("hint-anchor", block && "hint-anchor-block", className)}>
      {children}
      {visible && (
        <button
          ref={beaconRef}
          type="button"
          className="hint-beacon"
          // Beacons fade in one after another, in nav order, once the page
          // has had a moment to settle — arriving is calmer than being there.
          style={{ animationDelay: `${0.9 + order * 0.35}s` }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Tip: ${title}`}
          onClick={toggle}
        >
          <i aria-hidden />
        </button>
      )}
      {open && createPortal(
        <div ref={popoverRef} role="dialog" aria-labelledby={titleId} className="hint-pop" style={position ?? undefined}>
          <span className="hint-pop-eyebrow"><Sparkles size={11} aria-hidden /> Tip</span>
          <b id={titleId}>{title}</b>
          <p>{body}</p>
          <div className="hint-pop-actions">
            <button ref={confirmRef} type="button" className="hint-pop-confirm" onClick={() => context.dismiss(id)}>Got it</button>
            <button type="button" className="hint-pop-skip" onClick={() => context.dismissAll()}>Skip all tips</button>
          </div>
        </div>,
        document.body,
      )}
    </Anchor>
  );
}
