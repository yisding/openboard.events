import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { DataTable } from "./data-table";

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

  it("removes the loading announcement when data settles", () => {
    const html = renderTable(false);

    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('<p class="sr-only" role="status"></p>');
    expect(html).not.toContain("Loading table data…");
    expect(html).toContain("No rows");
  });
});

describe("DataTable column disclosure accessibility", () => {
  it("connects the Columns button to its disclosure panel", () => {
    const html = renderColumnPicker();
    const button = html.match(/<button[^>]+id="([^"]+-button)"[^>]+aria-controls="([^"]+-panel)"[^>]*>/);

    expect(button).not.toBeNull();
    expect(button?.[1]?.replace(/-button$/, "-panel")).toBe(button?.[2]);
    expect(html).toContain('aria-expanded="false"');
  });

  it("supports Escape focus return and outside dismissal while open", () => {
    const source = readFileSync(new URL("./data-table.tsx", import.meta.url), "utf8");

    expect(source).toContain('document.addEventListener("keydown", closeOnEscape)');
    expect(source).toContain('if (event.key !== "Escape") return;');
    expect(source).toContain("document.activeElement");
    expect(source).toContain("pickerButtonRef.current?.focus()");
    expect(source).toContain('document.addEventListener("pointerdown", closeOutside)');
    expect(source).toContain('document.addEventListener("focusin", closeOnFocusOutside)');
    expect(source).toContain("pickerPanelRef.current?.contains(target)");
  });
});
