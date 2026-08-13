import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const loader = readFileSync(new URL("../../../public/embed.js", import.meta.url), "utf8");

function runLoader(attributes: Record<string, string | null>) {
  const contentWindow = {};
  const iframe = { style: {} as Record<string, string>, contentWindow } as Record<string, unknown> & {
    style: Record<string, string>;
    contentWindow: object;
  };
  const insertBefore = vi.fn();
  const listener = vi.fn();
  const script = {
    src: "https://events.example/embed.js",
    getAttribute: (name: string) => attributes[name] ?? null,
    parentNode: { insertBefore },
  };
  const document = {
    currentScript: script,
    createElement: vi.fn(() => iframe),
  };
  const window = {
    addEventListener: vi.fn((event: string, callback: unknown) => {
      if (event === "message") listener.mockImplementation(callback as (...args: unknown[]) => unknown);
    }),
  };

  vm.runInNewContext(loader, { document, window, URL });
  return { contentWindow, iframe, insertBefore, listener };
}

describe("the public auto-resize embed loader", () => {
  it("uses the organizer-provided accessible title and block-level iframe layout", () => {
    const { iframe, insertBefore } = runLoader({
      "data-event": "openboard-live",
      "data-type": "agenda",
      "data-title": "Openboard Live — Agenda",
    });

    expect(iframe).toMatchObject({
      src: "https://events.example/embed/openboard-live/agenda",
      title: "Openboard Live — Agenda",
      loading: "lazy",
      style: { width: "100%", border: "0", display: "block", height: "760px" },
    });
    expect(insertBefore).toHaveBeenCalledOnce();
  });

  it("retains a useful fallback title for hand-authored legacy snippets", () => {
    const { iframe } = runLoader({ "data-event": "openboard-live", "data-type": "speakers" });
    expect(iframe.title).toBe("Openboard speakers embed");
  });

  it("accepts resize messages only from its own embed window and origin", () => {
    const { contentWindow, iframe, listener } = runLoader({ "data-event": "openboard-live", "data-type": "agenda" });

    listener({ origin: "https://other.example", source: contentWindow, data: { type: "openboard:embed-height", height: 900 } });
    expect(iframe.style.height).toBe("760px");

    listener({ origin: "https://events.example", source: contentWindow, data: { type: "openboard:embed-height", height: 900 } });
    expect(iframe.style.height).toBe("900px");
  });
});
