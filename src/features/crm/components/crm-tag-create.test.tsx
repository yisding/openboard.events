/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmTagIdSchema, organizationIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { CrmTagCreateControl } from "./crm-tag-create";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("c8000000-0000-4000-8000-000000000001");
const tagId = crmTagIdSchema.parse("c8000000-0000-4000-8000-000000000002");
const createdTag = { id: tagId, name: "VIP", color: "#00a878", createdAt: "2026-08-16T00:00:00.000Z" };

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

async function typeName(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="New tag name"]');
  if (!input) throw new Error("Tag name input was not rendered");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("CRM tag creation control", () => {
  it("creates a tag through the tags endpoint and reports it back to the parent", async () => {
    apiMock.mockResolvedValueOnce(createdTag);
    const onCreated = vi.fn();
    await act(async () => root.render(<CrmTagCreateControl organizationId={organizationId} onCreated={onCreated} />));

    await act(async () => { buttonNamed("New tag")?.click(); await Promise.resolve(); });
    await typeName("VIP");
    await act(async () => { buttonNamed("Add")?.click(); await Promise.resolve(); });

    expect(apiMock).toHaveBeenCalledWith(
      `organizations/${organizationId}/crm/tags`,
      expect.anything(),
      { method: "POST", body: { name: "VIP" } },
    );
    expect(onCreated).toHaveBeenCalledWith(createdTag);
    // Collapses back to the affordance after a successful create.
    expect(buttonNamed("New tag")).toBeDefined();
  });

  it("stays open and surfaces a duplicate-name error without calling back", async () => {
    apiMock.mockRejectedValueOnce(new AppError("CONFLICT", "A tag with this name already exists.", { field: "name" }));
    const onCreated = vi.fn();
    await act(async () => root.render(<CrmTagCreateControl organizationId={organizationId} onCreated={onCreated} />));

    await act(async () => { buttonNamed("New tag")?.click(); await Promise.resolve(); });
    await typeName("VIP");
    await act(async () => { buttonNamed("Add")?.click(); await Promise.resolve(); });

    expect(onCreated).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith("A tag with this name already exists.", { kind: "error" });
    // Still in the open form so the organizer can rename and retry.
    expect(container.querySelector('input[aria-label="New tag name"]')).not.toBeNull();
  });
});
