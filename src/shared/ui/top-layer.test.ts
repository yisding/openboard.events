/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import { dropFromTopLayer, raiseIntoTopLayer } from "./top-layer";

/**
 * The popover API stands in rather than runs for real: the contract under test
 * is "raise where it works, leave a plain visible element where it does not",
 * and the second half needs a DOM without the API whatever this environment
 * happens to implement. The stand-in records the calls in order — insertion
 * order into the top layer is the whole mechanism — and throws on the wrong
 * state exactly as the real API does, which is how `top-layer.ts` asks whether
 * an element is up there already.
 */
type Popover = { calls: string[]; restore: () => void };

function stubPopoverApi(mode: "working" | "failing" | "absent" = "working"): Popover {
  const calls: string[] = [];
  const prototype = HTMLElement.prototype as unknown as Record<string, unknown>;
  const before = { show: prototype.showPopover, hide: prototype.hidePopover };
  const restore = () => {
    if (before.show === undefined) delete prototype.showPopover; else prototype.showPopover = before.show;
    if (before.hide === undefined) delete prototype.hidePopover; else prototype.hidePopover = before.hide;
  };
  if (mode === "absent") {
    delete prototype.showPopover;
    delete prototype.hidePopover;
    return { calls, restore };
  }
  prototype.showPopover = function showPopover(this: HTMLElement) {
    if (mode === "failing" || this.hasAttribute("data-open")) throw new Error("InvalidStateError");
    calls.push(`show:${this.className}`);
    this.setAttribute("data-open", "");
  };
  prototype.hidePopover = function hidePopover(this: HTMLElement) {
    if (!this.hasAttribute("data-open")) throw new Error("InvalidStateError");
    calls.push(`hide:${this.className}`);
    this.removeAttribute("data-open");
  };
  return { calls, restore };
}

let popover: Popover | null = null;

function element(className: string): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  document.body.append(node);
  return node;
}

afterEach(() => {
  popover?.restore();
  popover = null;
  document.body.innerHTML = "";
});

describe("raiseIntoTopLayer", () => {
  it("shows the element as a manual popover, which is what puts it above an open dialog", () => {
    popover = stubPopoverApi();
    const card = element("tour-coach");

    raiseIntoTopLayer(card);

    expect(card.getAttribute("popover")).toBe("manual");
    expect(popover.calls).toEqual(["show:tour-coach"]);
  });

  it("re-enters at the end of the top layer, since order there is insertion order", () => {
    popover = stubPopoverApi();
    const card = element("tour-coach");

    raiseIntoTopLayer(card);
    raiseIntoTopLayer(card);

    // Hidden first: a popover already shown stays where it was put, which is
    // under the dialog that opened after it.
    expect(popover.calls).toEqual(["show:tour-coach", "hide:tour-coach", "show:tour-coach"]);
  });

  it("leaves an ordinary visible element behind when showing fails", () => {
    popover = stubPopoverApi("failing");
    const stack = element("toast-stack");

    raiseIntoTopLayer(stack);

    // Not merely un-raised: an element still carrying `popover` that the UA
    // never opened is display:none, which would lose the toast entirely.
    expect(stack.hasAttribute("popover")).toBe(false);
  });

  it("does nothing at all without popover support", () => {
    popover = stubPopoverApi("absent");
    const stack = element("toast-stack");

    raiseIntoTopLayer(stack);

    expect(stack.hasAttribute("popover")).toBe(false);
  });

  it("tolerates a missing element", () => {
    expect(() => raiseIntoTopLayer(null)).not.toThrow();
  });
});

describe("dropFromTopLayer", () => {
  it("returns a raised element to its own z-index", () => {
    popover = stubPopoverApi();
    const card = element("tour-coach");

    raiseIntoTopLayer(card);
    dropFromTopLayer(card);

    expect(card.hasAttribute("popover")).toBe(false);
    expect(popover.calls).toEqual(["show:tour-coach", "hide:tour-coach"]);
  });

  it("leaves an element that was never raised alone", () => {
    popover = stubPopoverApi();
    const card = element("tour-coach");

    dropFromTopLayer(card);

    expect(popover.calls).toEqual([]);
  });
});
