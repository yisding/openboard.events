"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ANCHOR_TIMEOUT_MS } from "./objectives";
import { prefersReducedMotion } from "./media";
import type { TourAnchorSpec } from "./types";

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
  const scrolledFor = useRef<TourAnchorSpec | null>(null);

  useEffect(() => {
    if (!active || !spec || spec.kind === "none" || typeof document === "undefined") {
      setElement(null);
      setRect(null);
      setStatus("idle");
      return;
    }
    setStatus("resolving");
    let current: HTMLElement | null = null;
    const attempt = () => {
      const next = resolveAnchorElement(spec, document);
      if (next === null) {
        // The target was here and went away — a tab switched, a drawer closed.
        // Drop back to resolving rather than spotlighting a detached node.
        if (current !== null && !current.isConnected) {
          current = null;
          setElement(null);
          setStatus("resolving");
        }
        return;
      }
      if (next === current) return;
      current = next;
      setElement(measurableElement(next));
      setStatus("found");
    };
    attempt();
    const observer = typeof MutationObserver === "function" ? new MutationObserver(attempt) : null;
    observer?.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tour", "class", "aria-label", "role", "hidden", "aria-hidden"],
    });
    const timer = window.setTimeout(() => {
      if (current === null) setStatus("missing");
    }, ANCHOR_TIMEOUT_MS);
    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, [spec, active]);

  useEffect(() => {
    if (!element) {
      setRect(null);
      return;
    }
    const animated = typeof window.requestAnimationFrame === "function";
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!element.isConnected) {
        setElement(null);
        setStatus("resolving");
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

  // One scroll per step, on arm. Repeating it on every re-measure would fight
  // the player for control of the viewport.
  useEffect(() => {
    if (!element || !spec || scrolledFor.current === spec) return;
    scrolledFor.current = spec;
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
