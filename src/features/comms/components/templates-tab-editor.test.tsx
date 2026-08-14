/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import type { EmailTemplateRow } from "@/features/comms";
import { TemplatesTab } from "./templates-tab";

const insertAtCursorMock = vi.hoisted(() => vi.fn());
const previewMutateMock = vi.hoisted(() => vi.fn());
const templatesHookState = vi.hoisted(() => ({ data: [] as EmailTemplateRow[] }));

vi.mock("@/shared/ui/app/rich-text-editor-lazy", async () => {
  const ReactModule = await import("react");
  return {
    RichTextEditor: ReactModule.forwardRef(function MockRichTextEditor(
      props: { value: string; onChange: (html: string) => void; ariaLabel?: string },
      ref: React.ForwardedRef<{ insertAtCursor: (text: string) => boolean }>,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        insertAtCursor(text: string) {
          insertAtCursorMock(text);
          props.onChange(`${props.value}${text}`);
          return true;
        },
      }), [props]);
      return <div role="textbox" aria-label={props.ariaLabel} data-html={props.value}>{props.value.replace(/<[^>]+>/g, "")}</div>;
    }),
  };
});
vi.mock("../hooks/use-templates", () => ({
  useTemplates: () => ({ data: templatesHookState.data, refetch: vi.fn() }),
  useSaveTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/use-template-preview", () => ({
  useTemplatePreview: () => ({ mutate: previewMutateMock, data: undefined, isPending: false, isError: false }),
}));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: vi.fn(),
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("./message-preview", () => ({ MessagePreview: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("e5000000-0000-4000-8000-000000000001");
const baseTemplate: EmailTemplateRow = {
  key: "submission_received",
  subject: "We received {{submission.title}}",
  bodyHtml: "<p>Hello <strong>team</strong></p>",
  enabled: true,
  updatedAt: "2026-08-13T12:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

async function mount(template: EmailTemplateRow = baseTemplate) {
  templatesHookState.data = [template];
  await act(async () => root.render(<TemplatesTab eventId={eventId} />));
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === name);
}

beforeEach(() => {
  insertAtCursorMock.mockReset();
  previewMutateMock.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TemplatesTab body editor", () => {
  it("opens existing templates in rich text mode without exposing source tags", async () => {
    await mount();

    expect(buttonNamed("Rich text")?.getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed("HTML")?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[role="textbox"][aria-label="Email body"]')?.textContent).toBe("Hello team");
    expect(container.textContent).not.toContain("<strong>");
    expect(container.querySelector('textarea[aria-label="Email body HTML source"]')).toBeNull();
  });

  it("sends body chips through the rich editor cursor API", async () => {
    await mount();
    const chip = container.querySelector<HTMLButtonElement>(".template-vars button");
    if (!chip) throw new Error("No template variable chip was rendered");

    await act(async () => chip.click());

    expect(insertAtCursorMock).toHaveBeenCalledWith(chip.textContent);
    expect(container.querySelector('[role="textbox"][aria-label="Email body"]')?.getAttribute("data-html")).toContain(chip.textContent);
  });

  it("inserts body chips at the selected cursor in HTML mode", async () => {
    await mount();
    await act(async () => buttonNamed("HTML")?.click());
    const source = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Email body HTML source"]');
    const chip = container.querySelector<HTMLButtonElement>(".template-vars button");
    if (!source || !chip) throw new Error("HTML source or template variable chip was not rendered");
    await act(async () => {
      source.focus();
      source.setSelectionRange(3, 3);
    });

    await act(async () => chip.click());

    expect(source.value).toBe(`${baseTemplate.bodyHtml.slice(0, 3)}${chip.textContent}${baseTemplate.bodyHtml.slice(3)}`);
    expect(insertAtCursorMock).not.toHaveBeenCalled();
  });

  it("sanitizes source before returning to rich text while preserving supported formatting", async () => {
    const source = '<h2>Hello</h2><script>alert(1)</script><p><strong>Team</strong></p>';
    await mount();
    await act(async () => buttonNamed("HTML")?.click());
    const sourceEditor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Email body HTML source"]');
    if (!sourceEditor) throw new Error("HTML source editor was not rendered");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(sourceEditor, source);
      sourceEditor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => buttonNamed("Rich text")?.click());
    const richValue = container.querySelector('[role="textbox"][aria-label="Email body"]')?.getAttribute("data-html") ?? "";
    expect(richValue).toContain("<h2>Hello</h2>");
    expect(richValue).toContain("<strong>Team</strong>");
    expect(richValue).not.toContain("script");
  });

  it("sanitizes existing templates before their first rich-text render", async () => {
    await mount({ ...baseTemplate, bodyHtml: '<p>Hello</p><script>alert(1)</script>' });

    const richValue = container.querySelector('[role="textbox"][aria-label="Email body"]')?.getAttribute("data-html") ?? "";
    expect(richValue).toBe("<p>Hello</p>");
  });
});
