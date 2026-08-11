import * as React from "react";
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
});
