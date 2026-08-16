/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmCustomFieldIdSchema, organizationIdSchema } from "@/shared/contracts";
import { CrmCustomFieldCreateDialog } from "./crm-custom-field-create-dialog";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("c6000000-0000-4000-8000-000000000001");
const fieldId = crmCustomFieldIdSchema.parse("c6000000-0000-4000-8000-000000000002");

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

async function fillLabel(text: string, value: string) {
  const field = [...container.querySelectorAll<HTMLLabelElement>(".field")].find((node) => node.textContent?.includes(text));
  const input = field?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (!input) throw new Error(`Input for "${text}" was not rendered`);
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("CRM custom field creation", () => {
  it("derives a machine key from the label and posts a text field", async () => {
    const created = { id: fieldId, key: "dietary_needs", label: "Dietary needs", fieldType: "text", options: [], sortOrder: 0 };
    apiMock.mockResolvedValueOnce(created);
    const onCreated = vi.fn();
    const onClose = vi.fn();
    await act(async () => root.render(<CrmCustomFieldCreateDialog organizationId={organizationId} open onClose={onClose} onCreated={onCreated} />));

    await fillLabel("Label", "Dietary needs");
    await act(async () => { buttonNamed("Create field")?.click(); await Promise.resolve(); });

    expect(apiMock).toHaveBeenCalledWith(
      `organizations/${organizationId}/crm/custom-fields`,
      expect.anything(),
      { method: "POST", body: { key: "dietary_needs", label: "Dietary needs", fieldType: "text", options: [] } },
    );
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends the newline-separated options only for a select field", async () => {
    const created = { id: fieldId, key: "shirt", label: "Shirt", fieldType: "select", options: ["S", "M"], sortOrder: 0 };
    apiMock.mockResolvedValueOnce(created);
    await act(async () => root.render(<CrmCustomFieldCreateDialog organizationId={organizationId} open onClose={vi.fn()} onCreated={vi.fn()} />));

    await fillLabel("Label", "Shirt");
    const select = container.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("Type select was not rendered");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "select");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await fillLabel("Options", "S\nM\n");
    await act(async () => { buttonNamed("Create field")?.click(); await Promise.resolve(); });

    expect(apiMock).toHaveBeenCalledWith(
      `organizations/${organizationId}/crm/custom-fields`,
      expect.anything(),
      { method: "POST", body: { key: "shirt", label: "Shirt", fieldType: "select", options: ["S", "M"] } },
    );
  });
});
