/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor";

const editorMock = vi.hoisted(() => {
  const run = vi.fn(() => true);
  const insertContent = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContent }));
  return {
    run,
    insertContent,
    focus,
    editor: {
      chain: () => ({ focus }),
      commands: { setContent: vi.fn() },
      getHTML: () => "<p>Hello</p>",
      getAttributes: () => ({}),
      isActive: () => false,
      setEditable: vi.fn(),
    },
  };
});

vi.mock("@tiptap/react", () => ({
  useEditor: () => editorMock.editor,
  EditorContent: () => <div className="mock-editor-content" />,
}));
vi.mock("./rich-text-link", () => ({ richTextLinkError: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  editorMock.focus.mockClear();
  editorMock.insertContent.mockClear();
  editorMock.run.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("RichTextEditor imperative handle", () => {
  it("focuses the editor and inserts a plain text node at its current selection", async () => {
    const ref = React.createRef<RichTextEditorHandle>();
    await act(async () => root.render(<RichTextEditor ref={ref} value="<p>Hello</p>" onChange={() => {}} />));

    expect(ref.current?.insertAtCursor("{{speaker.first_name}}")).toBe(true);
    expect(editorMock.focus).toHaveBeenCalledOnce();
    expect(editorMock.insertContent).toHaveBeenCalledWith({ type: "text", text: "{{speaker.first_name}}" });
    expect(editorMock.run).toHaveBeenCalledOnce();
  });
});
