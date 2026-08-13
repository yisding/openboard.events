import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

Object.assign(globalThis, { React });

describe("ConfirmDialog labels", () => {
  it("keeps Reload as the stale-recovery default", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open title="Changed" body="Load the saved version." variant="stale" onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(html).toContain(">Reload</button>");
  });

  it("uses a more specific stale-recovery action when supplied", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open title="Changed" body="Load the saved version." variant="stale" confirmLabel="Load latest" onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(html).toContain(">Load latest</button>");
  });

  it("can prevent confirmation until a preflight is ready", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open title="Review" body="Preparing…" confirmLabel="Send" confirmDisabled onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain(">Send</button>");
  });
});
