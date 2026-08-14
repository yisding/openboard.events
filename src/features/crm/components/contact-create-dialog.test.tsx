/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationContactIdSchema, organizationIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { ContactCreateDialog } from "./contact-create-dialog";

const apiMock = vi.hoisted(() => vi.fn());
const navigationMock = vi.hoisted(() => ({ push: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({ useRouter: () => navigationMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("c7000000-0000-4000-8000-000000000001");
const contactId = organizationContactIdSchema.parse("c7000000-0000-4000-8000-000000000002");

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

async function enterEmail(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="email"]');
  if (!input) throw new Error("Email input was not rendered");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  navigationMock.push.mockReset();
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

describe("manual CRM contact creation", () => {
  it("closes and navigates to the returned contact after creation succeeds", async () => {
    apiMock.mockResolvedValueOnce({ id: contactId });
    const onClose = vi.fn();
    await act(async () => root.render(<ContactCreateDialog organizationId={organizationId} open onClose={onClose} />));
    await enterEmail("new.contact@example.com");

    await act(async () => {
      buttonNamed("Add contact")?.click();
      await Promise.resolve();
    });

    expect(apiMock).toHaveBeenCalledWith(`organizations/${organizationId}/crm/contacts`, expect.anything(), {
      method: "POST",
      body: {
        email: "new.contact@example.com",
        firstName: undefined,
        lastName: undefined,
        company: undefined,
        jobTitle: undefined,
      },
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(navigationMock.push).toHaveBeenCalledWith(`/organizations/${organizationId}/crm/${contactId}`);
    expect(toastMock).toHaveBeenCalledWith("new.contact@example.com added to the directory");
  });

  it("keeps the dialog open and shows a definitive duplicate error", async () => {
    apiMock.mockRejectedValueOnce(new AppError(
      "CONFLICT",
      "A contact with this email already exists in this organization.",
      { field: "email" },
      { email: "A contact with this email already exists in this organization." },
    ));
    const onClose = vi.fn();
    await act(async () => root.render(<ContactCreateDialog organizationId={organizationId} open onClose={onClose} />));
    await enterEmail("existing@example.com");

    await act(async () => {
      buttonNamed("Add contact")?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("A contact with this email already exists in this organization.");
    expect(onClose).not.toHaveBeenCalled();
    expect(navigationMock.push).not.toHaveBeenCalled();
    expect(buttonNamed("Add contact")?.disabled).toBe(false);
  });
});
