import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaletteDialog } from "./command-palette";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

Object.assign(globalThis, { React });

describe("PaletteDialog", () => {
  it("associates the combobox with the active option by id", () => {
    const html = renderToStaticMarkup(React.createElement(PaletteDialog, {
      eventId: "00000000-0000-4000-8000-000000000001",
      base: "/events/00000000-0000-4000-8000-000000000001",
      role: "organizer",
      onClose: () => undefined,
    }));

    const activeId = html.match(/aria-activedescendant="([^"]+)"/)?.[1];
    const statusId = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(activeId).toBeTruthy();
    expect(statusId).toBeTruthy();
    expect(html).toContain(`id="${activeId}"`);
    expect(html).toContain(`id="${statusId}"`);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('aria-label="Close search"');
  });

  it("dismisses explicitly with Escape and restores focus to the trigger", () => {
    const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");

    expect(source).toContain('if (event.key === "Escape")');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("onClose();");
    expect(source).toContain("requestAnimationFrame(() => triggerRef.current?.focus())");
    expect(source).toContain('aria-label="Close search"');
  });

  it("leaves Enter on the close button to its native click activation", () => {
    const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");

    expect(source).toContain("if (event.target !== inputRef.current) return;");
    expect(source.indexOf("if (event.target !== inputRef.current) return;")).toBeLessThan(
      source.indexOf('if (event.key === "ArrowDown")'),
    );
  });

  it("routes imperative palette navigation through the unsaved-work guard", () => {
    const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
    const go = source.slice(source.indexOf("function go"), source.indexOf("function onKeyDown"));
    const guardedNavigation = go.slice(go.indexOf("runGuarded"));

    expect(go).toContain("isSameNavigationDestination");
    expect(guardedNavigation).toContain("router.push(item.href)");
    expect(go.indexOf("isSameNavigationDestination")).toBeLessThan(go.indexOf("runGuarded"));
    expect(go).toContain("runGuarded(() => allowNextNavigation(() => {");
    expect(go).toContain("{ destination: item.href }");
    expect(guardedNavigation.indexOf("router.push(item.href)")).toBeLessThan(guardedNavigation.indexOf("onClose()"));
  });

  it("connects live search feedback to the combobox and offers retry only after failure", () => {
    const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");

    expect(source).toContain("aria-describedby={searchStatusId}");
    expect(source).toContain('role={currentSearchState.status === "error" ? "alert" : "status"}');
    expect(source).toContain('aria-live={currentSearchState.status === "error" ? "assertive" : "polite"}');
    expect(source).toContain('aria-busy={currentSearchState.status === "loading"}');
    expect(source).toContain("feedback.retry && <button");
    expect(source).toContain("Retry search");
  });
});
