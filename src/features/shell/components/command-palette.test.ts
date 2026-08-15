import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaletteDialog, paletteEggsForQuery } from "./command-palette";
import { ToastProvider } from "@/shared/ui/toast";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

Object.assign(globalThis, { React });

describe("PaletteDialog", () => {
  it("associates the combobox with the active option by id", () => {
    const html = renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(PaletteDialog, {
      eventId: "00000000-0000-4000-8000-000000000001",
      base: "/events/00000000-0000-4000-8000-000000000001",
      role: "organizer",
      onClose: () => undefined,
    })));

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

  it("celebrates easter-egg selections in place instead of navigating", () => {
    const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
    const go = source.slice(source.indexOf("function go"), source.indexOf("function onKeyDown"));
    const eggBranch = go.slice(0, go.indexOf("runGuarded"));

    expect(eggBranch).toContain("emojiRain(egg.emojis)");
    expect(eggBranch).toContain("toast(egg.toast)");
    expect(eggBranch).toContain("return;");
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

describe("paletteEggsForQuery", () => {
  it("summons an egg for its trigger words, ignoring case and surrounding text", () => {
    expect(paletteEggsForQuery("panda").map((item) => item.key)).toEqual(["egg:pandas"]);
    expect(paletteEggsForQuery("  Release the TIGER  ").map((item) => item.key)).toEqual(["egg:tiger"]);
    expect(paletteEggsForQuery("🐯").map((item) => item.key)).toEqual(["egg:tiger"]);
    expect(paletteEggsForQuery("where is the coffee").map((item) => item.key)).toEqual(["egg:espresso"]);
    expect(paletteEggsForQuery("confetti please").map((item) => item.key)).toEqual(["egg:afterparty"]);
  });

  it("stays out of the way of real queries", () => {
    expect(paletteEggsForQuery("")).toEqual([]);
    expect(paletteEggsForQuery("   ")).toEqual([]);
    expect(paletteEggsForQuery("keynote scheduling")).toEqual([]);
  });

  it("marks every egg as a mystery item that never navigates", () => {
    for (const item of paletteEggsForQuery("panda tiger party coffee")) {
      expect(item.hint).toBe("???");
      expect(item.href).toBe("");
      expect(item.key.startsWith("egg:")).toBe(true);
    }
  });

  it("offers a reviewer commands only, never the entity search that would fail for them", () => {
    const html = renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(PaletteDialog, {
      eventId: "00000000-0000-4000-8000-000000000001",
      base: "/events/00000000-0000-4000-8000-000000000001",
      role: "reviewer",
      onClose: () => undefined,
    })));

    // The placeholder is the promise the palette makes. A reviewer's search
    // route answers FORBIDDEN and every result links somewhere they cannot go,
    // so promising speakers and submissions sets them up for an error with a
    // Retry button that can never succeed.
    expect(html).toContain('placeholder="Run a command"');
    expect(html).not.toContain("Jump to a speaker");
  });

  it("still offers an organizer the entity search", () => {
    const html = renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(PaletteDialog, {
      eventId: "00000000-0000-4000-8000-000000000001",
      base: "/events/00000000-0000-4000-8000-000000000001",
      role: "organizer",
      onClose: () => undefined,
    })));
    expect(html).toContain("Jump to a speaker");
  });

  it("does not fire the organizer-only search request for a reviewer", () => {
    const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
    // The guard belongs in the effect itself, not only in the copy: a reviewer
    // typing two characters must make no request at all.
    expect(source).toContain("if (!entitySearch || term.length < 2)");
    expect(source).toContain('const entitySearch = role !== "reviewer"');
  });
});
