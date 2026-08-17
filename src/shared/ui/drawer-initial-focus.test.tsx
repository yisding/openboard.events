/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowNavControls } from "./app/flow-nav-controls";
import { Drawer } from "./ui-kit";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** The shape every flow-through drawer opens with: title, prev/next, close. */
async function renderFlowDrawer() {
  await act(async () => {
    root.render(
      <Drawer
        open
        onClose={() => undefined}
        title="Observability for prompt pipelines"
        headerExtra={<FlowNavControls index={2} total={9} itemLabel="Observability for prompt pipelines" itemNoun="submission" onPrev={() => undefined} onNext={() => undefined} />}
      >
        <div className="drawer-body"><button type="button">Accept</button></div>
      </Drawer>,
    );
  });
}

function DrawerWithNamedFocus() {
  const nameRef = React.useRef<HTMLInputElement>(null);
  return (
    <Drawer open onClose={() => undefined} title="Add a speaker" initialFocusRef={nameRef}>
      <div className="drawer-body"><input ref={nameRef} aria-label="Full name" /></div>
    </Drawer>
  );
}

describe("where an opening drawer puts focus", () => {
  it("lands on the drawer's own heading, not on the control that navigates away from it", async () => {
    await renderFlowDrawer();

    const heading = container.querySelector<HTMLHeadingElement>(".drawer-title h2");
    expect(document.activeElement).toBe(heading);
    expect(heading?.textContent).toBe("Observability for prompt pipelines");
    // The heading is a landing spot, never a stop on the way through the drawer.
    expect(heading?.getAttribute("tabindex")).toBe("-1");

    // What `showModal()` picks when left alone is the first focusable
    // descendant — which in a flow drawer is the control that leaves.
    const firstFocusable = container.querySelector(".drawer button, .drawer input");
    expect(firstFocusable?.getAttribute("aria-label")).toBe("Previous submission");
    expect(document.activeElement).not.toBe(firstFocusable);
  });

  it("yields to a caller that names somewhere better to start", async () => {
    await act(async () => root.render(<DrawerWithNamedFocus />));

    expect(document.activeElement).toBe(container.querySelector('input[aria-label="Full name"]'));
  });
});
