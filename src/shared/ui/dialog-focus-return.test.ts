/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it } from "vitest";
import { focusAfterClose } from "./ui-kit";

/**
 * The shape both dialogs restore focus into: a panel that survives the
 * mutation, a row that does not, and a delete button inside the row.
 */
function listWithRow() {
  document.body.innerHTML = `
    <section class="data-panel" id="panel">
      <div class="rows" id="rows">
        <article id="row">
          <button id="delete" type="button">Delete</button>
        </article>
      </div>
    </section>`;
  const opener = document.getElementById("delete") as HTMLButtonElement;
  const ancestors: HTMLElement[] = [];
  for (let node = opener.parentElement; node && node !== document.body; node = node.parentElement) ancestors.push(node);
  return { opener, ancestors };
}

describe("where focus lands when a dialog closes", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("returns to the opener when the opener is still there", () => {
    const { opener, ancestors } = listWithRow();
    expect(focusAfterClose(opener, ancestors)).toBe(opener);
    expect(document.activeElement).toBe(opener);
  });

  it("falls back to the nearest surviving container when a delete removed the opener", () => {
    const { opener, ancestors } = listWithRow();
    // What the mutation does: the row, and the button inside it, are gone.
    document.getElementById("row")?.remove();
    expect(opener.isConnected).toBe(false);

    const landed = focusAfterClose(opener, ancestors);

    // Not <body> — the list the organizer was working in.
    expect(landed).toBe(document.getElementById("rows"));
    expect(document.activeElement).toBe(document.getElementById("rows"));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("gives the container a tab stop only while it holds focus", () => {
    const { opener, ancestors } = listWithRow();
    document.getElementById("row")?.remove();
    const rows = document.getElementById("rows") as HTMLElement;

    focusAfterClose(opener, ancestors);
    expect(rows.getAttribute("tabindex")).toBe("-1");

    rows.dispatchEvent(new Event("blur"));
    expect(rows.hasAttribute("tabindex")).toBe(false);
  });

  it("leaves a container that already manages its own tabindex alone", () => {
    const { opener, ancestors } = listWithRow();
    const rows = document.getElementById("rows") as HTMLElement;
    rows.setAttribute("tabindex", "0");
    document.getElementById("row")?.remove();

    focusAfterClose(opener, ancestors);
    rows.dispatchEvent(new Event("blur"));

    expect(rows.getAttribute("tabindex")).toBe("0");
  });

  it("does nothing when the whole subtree is gone", () => {
    const { opener, ancestors } = listWithRow();
    document.getElementById("panel")?.remove();
    expect(focusAfterClose(opener, ancestors)).toBeNull();
  });
});
