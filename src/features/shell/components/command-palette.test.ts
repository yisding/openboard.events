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
    expect(activeId).toBeTruthy();
    expect(html).toContain(`id="${activeId}"`);
    expect(html).toContain('aria-selected="true"');
  });

  it("routes imperative palette navigation through the unsaved-work guard", () => {
    const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
    const go = source.slice(source.indexOf("function go"), source.indexOf("function onKeyDown"));

    expect(go).toContain("runGuarded(() => allowNextNavigation(() => {");
    expect(go.indexOf("router.push(item.href)")).toBeLessThan(go.indexOf("onClose()"));
  });
});
