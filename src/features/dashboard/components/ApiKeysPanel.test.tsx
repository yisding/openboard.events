/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { UnsavedWorkGuardProvider } from "@/shared/ui/app/unsaved-work-guard";
import { API_KEY_LABEL_TOO_LONG_MESSAGE, type ApiKeyCreationOperation } from "../api-key-creation";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { settle } from "@tests/support/react";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const operationMock = vi.hoisted(() => {
  const frozen: ApiKeyCreationOperation = {
    operationId: "c0000000-0000-4000-8000-000000000001",
    label: "Judge export",
    plaintext: `ob_live_${"A".repeat(43)}`,
  };
  return {
    frozen,
    create: vi.fn((label: string): ApiKeyCreationOperation => ({ ...frozen, label: label.trim() })),
  };
});
const frozen = operationMock.frozen;

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/events/one/settings", useRouter: () => ({ push: routerPushMock }) }));
vi.mock("../api-key-creation", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api-key-creation")>(),
  newApiKeyCreationOperation: operationMock.create,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const existing = {
  id: "c0000000-0000-4000-8000-000000000003",
  name: "Existing integration",
  createdAt: "2026-08-13T12:00:00.000Z",
  lastUsedAt: null,
};

let container: HTMLDivElement;
let root: Root;


function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent?.trim() === name);
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return buttonsNamed(name)[0];
}

function labelInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="e.g. Judge dashboard script"]');
  if (!input) throw new Error("expected API key label input");
  return input;
}

function edit(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function paste(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertFromPaste" }));
}

async function openAndLabel() {
  await act(async () => buttonNamed("Create key")?.click());
  await act(async () => edit(labelInput(), frozen.label));
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  routerPushMock.mockReset();
  operationMock.create.mockClear();
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

async function renderPanel() {
  await act(async () => root.render(
    <UnsavedWorkGuardProvider>
      <Link href="/events/another/settings">Leave API keys</Link>
      <ApiKeysPanel eventId={eventId} initialKeys={[existing]} timezone="America/Los_Angeles" />
    </UnsavedWorkGuardProvider>,
  ));
}

describe("API key creation recovery", () => {
  it("retries the identical frozen operation after a lost response and shows its plaintext once", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        id: frozen.operationId,
        name: frozen.label,
        plaintext: frozen.plaintext,
        createdAt: "2026-08-13T12:01:00.000Z",
      });
    await renderPanel();
    await openAndLabel();

    const create = buttonsNamed("Create key").at(-1);
    await act(async () => create?.click());
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "POST", body: frozen });
    expect(container.textContent).toContain("Creation unconfirmed");
    expect(container.textContent).toContain("The outcome is unknown, so this window cannot be closed yet.");
    expect(labelInput().disabled).toBe(true);
    expect(buttonNamed("Cancel")?.disabled).toBe(true);
    expect(container.querySelector('button[aria-label="Close"]')).toBeNull();
    expect(buttonNamed("Revoke")?.disabled).toBe(true);

    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/events/another/settings"]')?.click());
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(buttonNamed("Discard changes")).toBeUndefined();
    expect(buttonNamed("Working…")?.disabled).toBe(true);
    expect(container.textContent).toContain("Wait for the current action to finish before leaving this page.");
    expect(buttonNamed("Retry exact creation")).toBeDefined();
    expect(buttonNamed("Create key")?.disabled).toBe(true);
    expect(operationMock.create).toHaveBeenCalledOnce();
    await act(async () => buttonNamed("Stay here")?.click());

    const recoveryDialog = container.querySelector<HTMLDialogElement>('dialog[aria-label="Create API key"]');
    expect(recoveryDialog).not.toBeNull();
    await act(async () => {
      recoveryDialog?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
      recoveryDialog?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.textContent).toContain("Creation unconfirmed");
    expect(buttonNamed("Retry exact creation")).toBeDefined();

    await act(async () => buttonNamed("Retry exact creation")?.click());
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[1]?.[2]).toEqual(apiMock.mock.calls[0]?.[2]);
    expect(container.textContent).toContain(frozen.plaintext);
    expect(container.textContent?.match(new RegExp(frozen.label, "gu"))?.length).toBeGreaterThanOrEqual(2);

    await act(async () => buttonNamed("Done")?.click());
    expect(container.textContent).not.toContain(frozen.plaintext);
    expect([...container.querySelectorAll("tbody tr")].filter((row) => row.textContent?.includes(frozen.label))).toHaveLength(1);
  });

  it("stays locked and truthful through repeated network ambiguity", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new AppError("INTERNAL", "gateway lost the response"));
    await renderPanel();
    await openAndLabel();

    await act(async () => buttonsNamed("Create key").at(-1)?.click());
    await settle();
    await act(async () => buttonNamed("Retry exact creation")?.click());
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[1]?.[2]).toEqual(apiMock.mock.calls[0]?.[2]);
    expect(container.textContent).toContain("Creation unconfirmed");
    expect(buttonNamed("Retry exact creation")).toBeDefined();
    expect(labelInput().disabled).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(
      "API key creation is unconfirmed. Retry the exact creation when your connection is available.",
      { kind: "error" },
    );
  });

  it("keeps the label editable after a definitive rejection", async () => {
    apiMock.mockRejectedValueOnce(new AppError("VALIDATION", "That label is not allowed"));
    await renderPanel();
    await openAndLabel();

    await act(async () => buttonsNamed("Create key").at(-1)?.click());
    await settle();

    expect(container.textContent).not.toContain("Creation unconfirmed");
    expect(labelInput().disabled).toBe(false);
    expect(labelInput().value).toBe(frozen.label);
    expect(buttonNamed("Cancel")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenCalledWith("That label is not allowed", { kind: "error" });
  });

  it("keeps ordinary creation dialogs dismissible by close, Escape, and backdrop", async () => {
    await renderPanel();

    await act(async () => buttonNamed("Create key")?.click());
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close?.disabled).toBe(false);
    await act(async () => close?.click());
    expect(container.querySelector('dialog[aria-label="Create API key"]')).toBeNull();

    await act(async () => buttonNamed("Create key")?.click());
    const escapeDialog = container.querySelector<HTMLDialogElement>('dialog[aria-label="Create API key"]');
    await act(async () => escapeDialog?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(container.querySelector('dialog[aria-label="Create API key"]')).toBeNull();

    await act(async () => buttonNamed("Create key")?.click());
    const backdropDialog = container.querySelector<HTMLDialogElement>('dialog[aria-label="Create API key"]');
    await act(async () => backdropDialog?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector('dialog[aria-label="Create API key"]')).toBeNull();
  });

  it("accepts a label at the 120-character boundary", async () => {
    const boundaryLabel = "A".repeat(120);
    apiMock.mockResolvedValueOnce({
      id: frozen.operationId,
      name: boundaryLabel,
      plaintext: frozen.plaintext,
      createdAt: "2026-08-13T12:01:00.000Z",
    });
    await renderPanel();
    await act(async () => buttonNamed("Create key")?.click());
    const input = labelInput();
    expect(input.hasAttribute("maxlength")).toBe(false);
    await act(async () => edit(input, boundaryLabel));
    expect(input.value).toHaveLength(120);
    expect(container.querySelector("#api-key-label-count")?.textContent).toBe("120 / 120 characters");
    expect(buttonsNamed("Create key").at(-1)?.disabled).toBe(false);

    await act(async () => buttonsNamed("Create key").at(-1)?.click());
    await settle();

    expect(operationMock.create).toHaveBeenCalledOnce();
    expect(operationMock.create).toHaveBeenCalledWith(boundaryLabel);
    expect(apiMock).toHaveBeenCalledOnce();
    expect(apiMock.mock.calls[0]?.[2]).toEqual({
      method: "POST",
      body: { ...frozen, label: boundaryLabel },
    });
  });

  it("blocks and explains a 121-character label before freezing or sending anything", async () => {
    const unhandledRejection = vi.fn((event: PromiseRejectionEvent) => event.preventDefault());
    window.addEventListener("unhandledrejection", unhandledRejection);
    try {
      await renderPanel();
      await act(async () => buttonNamed("Create key")?.click());
      const input = labelInput();
      expect(input.hasAttribute("maxlength")).toBe(false);
      await act(async () => paste(input, "B".repeat(121)));

      expect(input.value).toHaveLength(121);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe("api-key-label-error api-key-label-count");
      expect(container.querySelector("#api-key-label-count")?.textContent).toBe("121 / 120 characters");
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(API_KEY_LABEL_TOO_LONG_MESSAGE);
      expect(buttonsNamed("Create key").at(-1)?.disabled).toBe(true);

      // The button is blocked, and keyboard submission still reaches the
      // guarded validation path rather than freezing an operation.
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      await settle();

      expect(operationMock.create).not.toHaveBeenCalled();
      expect(apiMock).not.toHaveBeenCalled();
      expect(unhandledRejection).not.toHaveBeenCalled();
      expect(input.disabled).toBe(false);
      expect(container.textContent).not.toContain("Creation unconfirmed");
      expect(toastMock).toHaveBeenCalledWith(API_KEY_LABEL_TOO_LONG_MESSAGE, { kind: "error" });
    } finally {
      window.removeEventListener("unhandledrejection", unhandledRejection);
    }
  });

  it.each([
    ["trailing", `${"C".repeat(120)} `],
    ["leading", ` ${"C".repeat(120)}`],
  ])("counts and rejects a raw 121st %s whitespace character", async (_position, overlongLabel) => {
    await renderPanel();
    await act(async () => buttonNamed("Create key")?.click());
    const input = labelInput();
    await act(async () => edit(input, overlongLabel));

    expect(input.value).toBe(overlongLabel);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("#api-key-label-count")?.textContent).toBe("121 / 120 characters");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(API_KEY_LABEL_TOO_LONG_MESSAGE);
    expect(buttonsNamed("Create key").at(-1)?.disabled).toBe(true);

    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();

    expect(operationMock.create).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Creation unconfirmed");
    expect(toastMock).toHaveBeenCalledWith(API_KEY_LABEL_TOO_LONG_MESSAGE, { kind: "error" });
  });
});

describe("API key revoke outcome", () => {
  async function openRevokeAndConfirm() {
    await renderPanel();
    await act(async () => buttonNamed("Revoke")?.click());
    await settle();
    // The dialog's own confirm button is the second "Revoke" on screen.
    const confirm = buttonsNamed("Revoke").at(-1);
    await act(async () => confirm?.click());
    await settle();
  }

  it("restores the key and shows the server's reason when the revoke was definitively refused", async () => {
    apiMock.mockRejectedValueOnce(new AppError("FORBIDDEN", "You cannot revoke that key"));
    await openRevokeAndConfirm();

    expect(container.textContent).toContain("Existing integration");
    expect(toastMock).toHaveBeenCalledWith("You cannot revoke that key", { kind: "error" });
  });

  it("re-reads the list rather than claiming a key is restored when the outcome is unknown", async () => {
    // A lost response after the DELETE has already committed. Announcing "the
    // key has been restored" put a revoked — possibly leaked — key back on
    // screen as live, while every integration using it was getting 401.
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce([]);
    await openRevokeAndConfirm();

    expect(container.textContent).not.toContain("Existing integration");
    expect(toastMock).toHaveBeenCalledWith(
      "That revoke could not be confirmed. The list above is now current.",
      { kind: "error" },
    );
  });

  it("says the outcome is unknown when even the re-read fails", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new TypeError("still offline"));
    await openRevokeAndConfirm();

    expect(container.textContent).toContain("Existing integration");
    expect(toastMock).toHaveBeenCalledWith(
      "That revoke is unconfirmed. Restore your connection and check this list before assuming the key is still live.",
      { kind: "error" },
    );
  });
});

describe("API key panel copy", () => {
  // The intro used to send organizers to "docs/api.md" — a repo file path
  // they have no way to open (issue #670).
  it("does not point organizers at a repo file path", async () => {
    await renderPanel();
    expect(container.textContent).not.toContain("docs/api.md");
    expect(container.textContent).toContain("Authorization: Bearer");
  });
});
