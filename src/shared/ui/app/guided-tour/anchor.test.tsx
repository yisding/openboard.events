/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { measurableElement, portalTargetFor, resolveAnchorElement, tourIdPresent, useTourAnchor, type TourAnchorState } from "./anchor";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the anchor ladder", () => {
  it("prefers an existing semantic selector — the anchor that cannot rot silently", () => {
    mount('<nav class="dashboard-tabs"><button>Today</button></nav>');
    const found = resolveAnchorElement({ kind: "selector", css: ".dashboard-tabs" }, document);
    expect(found?.tagName).toBe("NAV");
  });

  it("finds a control by its frozen accessible name, and checks the role", () => {
    mount('<div aria-label="Review round"></div><select aria-label="Review round"></select>');
    const found = resolveAnchorElement({ kind: "role", role: "combobox", name: "Review round" }, document);
    expect(found?.tagName).toBe("SELECT");
  });

  it("falls back to visible text for a control named by its own label", () => {
    mount('<div role="tab">Grid</div><div role="tab">Conflicts</div>');
    const found = resolveAnchorElement({ kind: "role", role: "tab", name: "Conflicts" }, document);
    expect(found?.textContent).toBe("Conflicts");
  });

  it("resolves a pinned data-tour attribute", () => {
    mount('<table><tbody><tr data-tour="abstracts.row"><td>One</td></tr></tbody></table>');
    expect(resolveAnchorElement({ kind: "tour-id", id: "abstracts.row" }, document)?.tagName).toBe("TR");
    expect(tourIdPresent("abstracts.row", document)).toBe(true);
    expect(tourIdPresent("abstracts.missing", document)).toBe(false);
  });

  it("answers null for an anchor nothing on the page provides", () => {
    mount("<main></main>");
    expect(resolveAnchorElement({ kind: "selector", css: ".not-here" }, document)).toBe(null);
    expect(resolveAnchorElement({ kind: "none" }, document)).toBe(null);
  });

  it("does not let a quoted anchor id break out of its selector", () => {
    mount('<div data-tour=\'weird"id\'></div>');
    expect(resolveAnchorElement({ kind: "tour-id", id: 'weird"id' }, document)).not.toBe(null);
  });
});

describe("measuring a wrapper that has no box of its own", () => {
  it("descends from a display:contents TourAnchor to the control it wraps", () => {
    // `<TourAnchor>` renders `display: contents`, so its own rectangle is a
    // point at the origin — spotlighting it would put the hole in the corner.
    const host = mount('<span class="tour-anchor" data-tour="speakers.impersonate"><button>Open portal</button></span>');
    const wrapper = host.querySelector<HTMLElement>(".tour-anchor");
    const button = host.querySelector<HTMLElement>("button");
    if (!wrapper || !button) throw new Error("fixture did not mount");
    wrapper.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    button.getBoundingClientRect = () => new DOMRect(10, 20, 120, 32);
    expect(measurableElement(wrapper)).toBe(button);
  });

  it("keeps the element itself when it is the thing with the box", () => {
    const host = mount("<button>Publish</button>");
    const button = host.querySelector<HTMLElement>("button");
    if (!button) throw new Error("fixture did not mount");
    button.getBoundingClientRect = () => new DOMRect(0, 0, 90, 30);
    expect(measurableElement(button)).toBe(button);
  });
});

describe("holding on to a target the page swaps underneath it", () => {
  const SPEC = { kind: "selector", css: ".add-question" } as const;

  it("re-resolves after a late measurement drops an element the page has already replaced", async () => {
    /*
     * The exact interleaving the form builder produces when the tour walks the
     * player from one form to another: the old page's control is detached and
     * the new page's control — a *different* node with the same selector —
     * takes its place, while a frame the browser had already scheduled still
     * closes over the old one.
     *
     * The resolver adopts the new node; the late measurement then finds the
     * node *it* was watching disconnected and clears the anchor. If clearing
     * does not also make the resolver forget what it holds, its
     * "already handed this one over" short-circuit refuses to hand the new
     * node over again, and the step spends the rest of its life anchorless:
     * card marooned in the centre of the screen, no spotlight, no scroll, and
     * not even a notice — "missing" is never reached either.
     *
     * requestAnimationFrame is driven by hand so the frame lands after the
     * swap rather than before it, which is the whole point of the case.
     */
    const frames: Array<() => void> = [];
    const realRaf = window.requestAnimationFrame;
    const realCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: () => void) => frames.push(callback)) as never;
    // The browser does not un-schedule a frame it is already dispatching, and
    // that is the frame this case is about.
    window.cancelAnimationFrame = (() => undefined) as never;

    const host = mount('<div class="page"><button class="add-question" id="old">Add question</button></div>');
    const page = host.querySelector<HTMLElement>(".page");
    const before = host.querySelector<HTMLElement>("#old");
    if (!page || !before) throw new Error("fixture did not mount");

    let state: TourAnchorState = { element: null, rect: null, status: "idle" };
    function Probe() {
      state = useTourAnchor(SPEC, true);
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(React.createElement(Probe)); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(state.element).toBe(before);

      // A frame scheduled while the old control was still the anchor.
      await act(async () => { window.dispatchEvent(new Event("scroll")); });
      expect(frames.length).toBeGreaterThan(0);

      const after = document.createElement("button");
      after.className = "add-question";
      after.id = "new";
      await act(async () => {
        before.remove();
        page.append(after);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(state.element).toBe(after);

      // The stale frame finally runs, sees the node it was watching detached,
      // and gives the anchor up.
      await act(async () => {
        for (const frame of frames.splice(0)) frame();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(state.element).toBe(after);
      expect(state.status).toBe("found");
    } finally {
      await act(async () => { root.unmount(); });
      window.requestAnimationFrame = realRaf;
      window.cancelAnimationFrame = realCancel;
    }
  });
});

describe("moving from one step to the next", () => {
  const HERE = { kind: "selector", css: ".add-question" } as const;
  const ELSEWHERE = { kind: "selector", css: ".never-mounts-here" } as const;

  it("lets go of the last step's element the moment the step changes", async () => {
    // Otherwise the spotlight outlives the card that asked for it: the next
    // step's anchor is a page away, its own card is already saying so, and the
    // hole is still framing the control the *previous* card was about.
    mount('<div class="page"><button class="add-question">Add question</button></div>');
    const held = document.querySelector<HTMLElement>(".add-question");
    if (!held) throw new Error("fixture did not mount");
    held.getBoundingClientRect = () => new DOMRect(10, 20, 120, 32);

    let state: TourAnchorState = { element: null, rect: null, status: "idle" };
    function Probe({ spec }: { spec: typeof HERE | typeof ELSEWHERE }) {
      state = useTourAnchor(spec, true);
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(React.createElement(Probe, { spec: HERE })); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(state.element).toBe(held);
      expect(state.rect).not.toBe(null);

      await act(async () => { root.render(React.createElement(Probe, { spec: ELSEWHERE })); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(state.element).toBe(null);
      expect(state.rect).toBe(null);
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});

describe("re-measuring after a mutation that leaves the anchor itself untouched", () => {
  const SPEC = { kind: "tour-id", id: "agenda.publish" } as const;

  it("catches a rect that moved because a validation error inserted a banner above it", async () => {
    // The case that screwed up the tour highlighting: ticking an unscheduled
    // session and pressing Publish grows the page with a new alert banner
    // *above* the button, pushing it down without resizing it, moving the
    // window, or firing scroll — nothing a ResizeObserver on the button or a
    // window listener was ever going to see. Only the resolver's own
    // MutationObserver notices the insertion, and `attempt()` alone does
    // nothing with it because the anchored element hasn't changed. Without a
    // way to reach the measurer, the spotlight stayed at the button's
    // pre-banner coordinates.
    const frames: FrameRequestCallback[] = [];
    const realRaf = window.requestAnimationFrame;
    // `push` doubles as the handle: it returns the queue length, which is the
    // `number` the real signature promises, so no `never` cast is needed.
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as typeof window.requestAnimationFrame;

    const host = mount('<div class="page"><button data-tour="agenda.publish">Publish selected</button></div>');
    const page = host.querySelector<HTMLElement>(".page");
    const button = host.querySelector<HTMLElement>('[data-tour="agenda.publish"]');
    if (!page || !button) throw new Error("fixture did not mount");
    button.getBoundingClientRect = () => new DOMRect(40, 200, 120, 32);

    let state: TourAnchorState = { element: null, rect: null, status: "idle" };
    function Probe() {
      state = useTourAnchor(SPEC, true);
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(React.createElement(Probe)); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(state.element).toBe(button);
      expect(state.rect?.top).toBe(200);

      // The validation-error banner: a sibling mounts above the button and the
      // button's own box moves with it — nothing about the button itself
      // (its attributes, its identity) changed.
      button.getBoundingClientRect = () => new DOMRect(40, 300, 120, 32);
      const banner = document.createElement("div");
      banner.setAttribute("role", "alert");
      await act(async () => {
        page.prepend(banner);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(state.element).toBe(button);
      // Still the stale rect until the frame the mutation scheduled runs — a
      // synchronous remeasure would already read 300 here.
      expect(state.rect?.top).toBe(200);
      for (const frame of frames.splice(0)) frame(0);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(state.rect?.top).toBe(300);
    } finally {
      await act(async () => { root.unmount(); });
      window.requestAnimationFrame = realRaf;
    }
  });
});

describe("the native dialog top layer", () => {
  it("portals the coach into the open dialog its anchor lives in", () => {
    // Nothing z-indexed can paint above the top layer, so a card portalled to
    // <body> would render underneath the dialog it is describing.
    const host = mount('<dialog open class="modal-shell"><button data-tour="abstracts.decision-notify">Notify</button></dialog>');
    const button = host.querySelector<HTMLElement>("[data-tour]");
    expect(portalTargetFor(button ?? null)?.tagName).toBe("DIALOG");
  });

  it("portals to the body for everything else", () => {
    const host = mount("<main><button>Publish</button></main>");
    expect(portalTargetFor(host.querySelector("button"))).toBe(document.body);
  });

  it("ignores a dialog that is closed", () => {
    const host = mount("<dialog><button>Hidden</button></dialog>");
    expect(portalTargetFor(host.querySelector("button"))).toBe(document.body);
  });
});
