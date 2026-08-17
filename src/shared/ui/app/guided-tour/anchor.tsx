"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ANCHOR_TIMEOUT_MS } from "./objectives";
import { prefersReducedMotion } from "./media";
import type { TourAnchorSpec } from "./types";

/**
 * Resolving and measuring both run *before paint*.
 *
 * As passive effects they ran after it, so every step's first frame was drawn
 * with no element and no rectangle: the coach painted centred in the middle of
 * the screen and the spotlight was absent, and both snapped to the anchor on
 * the following frame. That double-take is the flicker organizers reported,
 * and it happened on every step whose anchor was already mounted — which is
 * most of them. `useLayoutEffect` on the server is a no-op that warns, so the
 * hook degrades to the passive one where there is no window.
 */
export const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Finding the thing the tour is pointing at, and keeping the measurement true
 * while the page moves underneath it.
 *
 * Two rules shape everything here:
 *
 *   1. **Targets arrive late.** Half the interesting controls live behind a
 *      `QueryBoundary`, a `WidgetBoundary`, a tab panel or a drawer, so a
 *      single `querySelector` on arm finds nothing. A `MutationObserver`
 *      retries until the element shows up, and gives up after six seconds by
 *      degrading to an anchorless card — never by failing to render.
 *   2. **Drift is re-measured, never fatal.** `first-run-hints` closes its
 *      card on any scroll, which is right for an ambient beacon and wrong for
 *      a tutorial whose first act is to scroll its own target into view.
 */

export type TourRect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export type TourAnchorStatus = "idle" | "resolving" | "found" | "missing";

export type TourAnchorState = { element: HTMLElement | null; rect: TourRect | null; status: TourAnchorStatus };

/**
 * Wraps UI that the tour needs to point at but cannot address any other way.
 * It renders as `display: contents`, so it adds a `data-tour` hook and changes
 * nothing about layout — inert for reviewers, on mobile, outside a tour, and
 * in every unit test that happens to render the component underneath it.
 */
export function TourAnchor({ id, children }: { id: string; children: ReactNode }) {
  return <span className="tour-anchor" data-tour={id}>{children}</span>;
}

/* Only the roles the anchor ladder actually reaches for. An element with an
   explicit `role` attribute always wins; this covers the implicit cases so a
   plain `<button aria-label="…">` still answers `{ kind: "role", role: "button" }`. */
const IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  a: "link",
  aside: "complementary",
  button: "button",
  dialog: "dialog",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  input: "textbox",
  nav: "navigation",
  ol: "list",
  option: "option",
  select: "combobox",
  table: "table",
  textarea: "textbox",
  ul: "list",
};

function elementRole(element: Element): string | null {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  return IMPLICIT_ROLES[element.tagName.toLowerCase()] ?? null;
}

function hasBox(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/** Prefer a candidate that is actually painted; fall back to the first match. */
function firstUsable(candidates: readonly HTMLElement[]): HTMLElement | null {
  return candidates.find(hasBox) ?? candidates[0] ?? null;
}

/**
 * A `TourAnchor` wrapper is `display: contents` and therefore has no box of
 * its own. Measure the first descendant that does, so the spotlight lands on
 * the control rather than collapsing to a point at the origin.
 */
export function measurableElement(element: HTMLElement): HTMLElement {
  if (hasBox(element)) return element;
  const painted = [...element.querySelectorAll<HTMLElement>("*")].find(hasBox);
  return painted ?? element;
}

/**
 * Attribute values are compared, never interpolated into a selector: an
 * accessible name is authored English and may contain a quote, an apostrophe
 * or a backslash, and a selector that has to be escaped is a selector that
 * will one day be escaped wrong.
 */
function byAttribute(root: ParentNode, attribute: string, value: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].filter(
    (element) => element.getAttribute(attribute) === value,
  );
}

export function resolveAnchorElement(spec: TourAnchorSpec, root: ParentNode): HTMLElement | null {
  if (spec.kind === "none") return null;
  if (spec.kind === "selector") return firstUsable([...root.querySelectorAll<HTMLElement>(spec.css)]);
  if (spec.kind === "tour-id") return firstUsable(byAttribute(root, "data-tour", spec.id));
  // Accessible name first: those strings are already frozen by an AST test,
  // which makes them the cheapest stable anchor in the repo. Visible text is
  // the fallback for controls named by their own label (tabs, mostly).
  const labelled = byAttribute(root, "aria-label", spec.name);
  const byRole = labelled.filter((element) => elementRole(element) === spec.role);
  if (byRole.length > 0) return firstUsable(byRole);
  if (labelled.length > 0) return firstUsable(labelled);
  const byText = [...root.querySelectorAll<HTMLElement>("*")].filter(
    (element) => elementRole(element) === spec.role && element.textContent?.trim() === spec.name,
  );
  return firstUsable(byText);
}

/**
 * Whether the element the resolver already holds is still the right answer.
 *
 * The observer watches the whole document for class and attribute churn, so it
 * fires constantly in a live app — a spinner, a live region, a hover. Every
 * one of those firings re-ran the full resolution, and a `role` anchor that
 * falls through to its text rung walks every element on the page to do it.
 * Three cheap checks answer the overwhelmingly common case ("nothing about my
 * anchor changed") without touching the rest of the document.
 *
 * `hasBox` is part of the answer, not an optimisation: `firstUsable` prefers a
 * painted candidate, so a held element that has since collapsed has to go back
 * through the full resolution in case a painted one has appeared.
 */
function stillResolves(element: HTMLElement, spec: TourAnchorSpec): boolean {
  if (!element.isConnected || !hasBox(element)) return false;
  if (spec.kind === "selector") return element.matches(spec.css);
  if (spec.kind === "tour-id") return element.getAttribute("data-tour") === spec.id;
  if (spec.kind === "role") {
    return element.getAttribute("aria-label") === spec.name || element.textContent?.trim() === spec.name;
  }
  return false;
}

function toRect(box: DOMRect): TourRect {
  return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
}

function sameRect(current: TourRect | null, box: DOMRect): boolean {
  return current !== null
    && Math.abs(current.top - box.top) < 0.5
    && Math.abs(current.left - box.left) < 0.5
    && Math.abs(current.width - box.width) < 0.5
    && Math.abs(current.height - box.height) < 0.5;
}

/**
 * Resolves `spec` against the live document and keeps its rectangle current.
 *
 * `spec` is expected to be referentially stable for the life of a step — the
 * script's step objects are module constants, so it is.
 */
export function useTourAnchor(spec: TourAnchorSpec | undefined, active: boolean): TourAnchorState {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [status, setStatus] = useState<TourAnchorStatus>("idle");
  const scrolledFor = useRef<{ spec: TourAnchorSpec; element: HTMLElement } | null>(null);
  /**
   * The element the resolver last accepted, shared with the measuring effect
   * below — which is the *other* place that can decide the anchor is gone.
   *
   * While it was a local of the resolving effect the two disagreed: the
   * measurer dropped a detached element and cleared the state, the resolver
   * went on believing it had already handed that node over, and its
   * `next === current` short-circuit refused to hand it over again. A node
   * React detaches and re-attaches — which is what happens to a control that
   * survives reconciliation across a soft navigation between two routes
   * sharing a layout, like the form builder's Add question button moving from
   * one form to another — left the card anchorless and centred for the rest of
   * the step: no spotlight, no scroll, and no notice either, because "missing"
   * was never reached.
   */
  const foundRef = useRef<HTMLElement | null>(null);
  /** Set by the resolving effect; called by the measurer when its element goes. */
  const reresolveRef = useRef<() => void>(() => undefined);

  useMeasureEffect(() => {
    if (!active || !spec || spec.kind === "none" || typeof document === "undefined") {
      setElement(null);
      setRect(null);
      setStatus("idle");
      return;
    }
    setStatus("resolving");
    foundRef.current = null;
    // The *previous* step's element goes with it. Without this the held
    // element outlived the step that asked for it: a new step whose anchor
    // never mounts — a control one navigation away, a panel that only exists
    // once the player has started — kept the last step's rect, so the
    // spotlight went on framing a control the card was no longer talking
    // about while the card itself said "that control isn't on this screen".
    // Two answers on screen at once, and the wrong one was the loud one.
    // `attempt()` below runs in this same effect, so a step whose anchor *is*
    // already mounted re-fills this in the same commit and nothing flickers.
    setElement(null);
    let timer = 0;
    // Re-armed on every drop back to `resolving`, not set once for the life of
    // the step. A one-shot timer expires while the anchor is still *found*, so
    // an element that later goes away — the `<dialog>` this step pointed into
    // being closed, a tab switched — leaves the status stuck on `resolving`
    // forever: no rect, so no spotlight, and `anchorless` is false, so no
    // "Nothing to point at yet" notice and no "Take me there" either.
    const armTimeout = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (foundRef.current === null) setStatus("missing");
      }, ANCHOR_TIMEOUT_MS);
    };
    const attempt = () => {
      const held = foundRef.current;
      if (held !== null && stillResolves(held, spec)) return;
      const next = resolveAnchorElement(spec, document);
      if (next === null) {
        // The target was here and went away — a tab switched, a drawer closed.
        // Drop back to resolving rather than spotlighting a detached node.
        if (foundRef.current !== null && !foundRef.current.isConnected) {
          foundRef.current = null;
          setElement(null);
          setStatus("resolving");
          armTimeout();
        }
        return;
      }
      if (next === foundRef.current) return;
      foundRef.current = next;
      setElement(measurableElement(next));
      setStatus("found");
    };
    // The measurer's way back in. Forgetting the held element first is the
    // whole point: the node it just watched detach may be the very node
    // `resolveAnchorElement` hands back a frame later.
    reresolveRef.current = () => {
      foundRef.current = null;
      setElement(null);
      setStatus("resolving");
      armTimeout();
      attempt();
    };
    attempt();
    const observer = typeof MutationObserver === "function" ? new MutationObserver(attempt) : null;
    observer?.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tour", "class", "aria-label", "role", "hidden", "aria-hidden"],
    });
    armTimeout();
    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      reresolveRef.current = () => undefined;
    };
  }, [spec, active]);

  useMeasureEffect(() => {
    if (!element) {
      setRect(null);
      return;
    }
    const animated = typeof window.requestAnimationFrame === "function";
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!element.isConnected) {
        reresolveRef.current();
        return;
      }
      const box = element.getBoundingClientRect();
      setRect((held) => (sameRect(held, box) ? held : toRect(box)));
    };
    const schedule = () => {
      if (frame !== 0) return;
      frame = animated ? window.requestAnimationFrame(measure) : window.setTimeout(measure, 16);
    };
    measure();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(element);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) {
        if (animated) window.cancelAnimationFrame(frame);
        else window.clearTimeout(frame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [element]);

  // One scroll per resolved target, not per step. Repeating it on every
  // re-measure would fight the player for control of the viewport; keying it on
  // the step alone meant a step that armed on one page and then followed the
  // tour's own navigation to another spent its scroll on the page the player
  // was leaving, and pointed at a control below the fold on the page they
  // arrived at.
  useEffect(() => {
    if (!element || !spec) return;
    const scrolled = scrolledFor.current;
    if (scrolled && scrolled.spec === spec && scrolled.element === element) return;
    scrolledFor.current = { spec, element };
    element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [element, spec]);

  return { element, rect, status };
}

/**
 * The native `<dialog>` top layer paints above every z-index, so a scrim can
 * never dim it and a portalled card can never sit on top of it. When the
 * anchor lives inside an open dialog the coach portals into that dialog
 * instead, and the dialog's own `::backdrop` does the scrim's job.
 */
export function portalTargetFor(element: HTMLElement | null): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return element?.closest("dialog[open]") ?? document.body;
}

/** Whether a `via: "dom"` target is mounted right now. */
export function tourIdPresent(id: string, root: ParentNode): boolean {
  return byAttribute(root, "data-tour", id).length > 0;
}
