import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { DataTable, pickerClearance } from "./data-table";

type Row = { id: string; name: string };

const columns: Array<ColumnDef<Row, unknown>> = [
  { accessorKey: "name", header: "Name" },
];

Object.assign(globalThis, { React });

function renderTable(isLoading: boolean): string {
  return renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={[]}
      empty={<p>No rows</p>}
      isLoading={isLoading}
    />,
  );
}

function renderColumnPicker(): string {
  return renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={[]}
      empty={<p>No rows</p>}
      columnVisibilityKey="people"
    />,
  );
}

describe("DataTable loading accessibility", () => {
  it("announces loading and marks the table region busy", () => {
    const html = renderTable(true);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading table data…");
    expect(html).not.toContain("No rows");
  });

  it("keeps one atomic polite region for selection counts, separate from loading", () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} data={[]} empty={<p>No rows</p>} enableSelection />,
    );
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('<p class="sr-only" role="status"></p>');
  });

  it("removes the loading announcement when data settles", () => {
    const html = renderTable(false);

    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('<p class="sr-only" role="status"></p>');
    expect(html).not.toContain("Loading table data…");
    expect(html).toContain("No rows");
  });

  it("disables ineligible rows and leaves select-all limited to eligible rows", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={[{ id: "eligible", name: "Eligible" }, { id: "blocked", name: "Blocked" }]}
        empty={<p>No rows</p>}
        enableSelection
        isRowSelectable={(row) => row.id === "eligible"}
      />,
    );

    expect(html).toContain('aria-label="Select row blocked" disabled=""');
    expect(html).toContain('aria-label="Select row eligible"');
    expect(html).not.toContain('aria-label="Select row eligible" checked="" disabled=""');
  });
});

describe("DataTable column disclosure accessibility", () => {
  it("connects the Columns button to its disclosure panel", () => {
    const html = renderColumnPicker();
    const source = readFileSync(new URL("./data-table.tsx", import.meta.url), "utf8");
    const button = html.match(/<button[^>]+id="([^"]+-button)"[^>]*>/);

    expect(button).not.toBeNull();
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("aria-controls=");
    expect(source).toContain("aria-controls={pickerOpen ? pickerPanelId : undefined}");
  });

  it("supports Escape focus return and outside dismissal while open", () => {
    const source = readFileSync(new URL("./data-table.tsx", import.meta.url), "utf8");

    expect(source).toContain('document.addEventListener("keydown", closeOnEscape)');
    expect(source).toContain('if (event.key !== "Escape") return;');
    expect(source).toContain("document.activeElement");
    expect(source).toContain("if (!pickerOpen) event.currentTarget.focus()");
    expect(source).toContain("pickerButtonRef.current?.focus()");
    expect(source).toContain('document.addEventListener("pointerdown", closeOutside)');
    expect(source).toContain('document.addEventListener("focusin", closeOnFocusOutside)');
    expect(source).toContain("pickerPanelRef.current?.contains(target)");
  });
});

describe("the column picker's escape from the clipped panel", () => {
  const source = readFileSync(new URL("./data-table.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

  // The toolbar sits inside `.data-panel{overflow:clip}`, whose clip box ends at
  // the last row. On a short or filtered table the bottom of the checkbox list
  // was painted outside it and never drawn — and `clip` is not a scroll
  // container, so the only workaround was to widen the result set.
  it("opens the picker outside the panel that would clip it", () => {
    expect(css).toContain(".data-panel{overflow:clip");
    expect(css).toContain(".column-picker{position:fixed;z-index:300;");
    expect(css).not.toContain(".column-picker{position:absolute");
    expect(source).toContain("createPortal((");
    expect(source).toContain("), document.body)}");
    expect(source).toContain('popoverPosition(\n      "bottom-end",');
    // Fixed coordinates are measured once, so a scroll has to dismiss it.
    expect(source).toContain('window.addEventListener("scroll", closeOnScroll, true)');
  });

  it("reserves the picker's worst-case height so it stays inside the viewport", () => {
    // Every row at the 44px touch height the small-viewport rules give it.
    expect(pickerClearance(8)).toBe(8 * 44 + 16);
    expect(pickerClearance(0)).toBe(44 + 16);
  });
});

describe("rows that offer to be clicked", () => {
  it("limits the pointer cursor and hover tint to rows with a row action", () => {
    const source = readFileSync(new URL("./data-table.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

    expect(css).toContain(".data-table tbody tr.clickable{cursor:pointer");
    expect(css).toContain(".data-table tbody tr.clickable:hover,.data-table tbody tr.selected{");
    expect(source).toContain('onRowClick ? "clickable" : ""');
  });
});
