/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeTemplateBody } from "@/shared/lib/template-body";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("RichTextEditor content preservation", () => {
  it("keeps merge-token links and preformatted blocks after a visual edit", async () => {
    const ref = React.createRef<RichTextEditorHandle>();
    const onChange = vi.fn();
    await act(async () => root.render(
      <RichTextEditor
        ref={ref}
        value={'<p><a href="{{portal.magic_link}}">Portal</a></p><pre><code>line one</code></pre>'}
        onChange={onChange}
        sanitizeHtml={sanitizeTemplateBody}
      />,
    ));

    expect(container.querySelector("a")?.getAttribute("href")).toBe("{{portal.magic_link}}");
    expect(container.querySelector("pre code")?.textContent).toBe("line one");

    await act(async () => { ref.current?.insertAtCursor("edited "); });
    const emitted = onChange.mock.lastCall?.[0] as string | undefined;
    expect(emitted).toContain('href="{{portal.magic_link}}"');
    expect(emitted).toContain("<pre><code>");
    expect(emitted).toContain("edited ");
  });
});
