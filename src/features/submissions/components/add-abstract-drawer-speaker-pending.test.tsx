/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionVocabulary } from "@/features/submissions";
import { AddAbstractDrawer } from "./add-abstract-drawer";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
const runGuardedMock = vi.hoisted(() => vi.fn((action: () => void) => action()));
const unsavedWorkGuardMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: unsavedWorkGuardMock,
  useGuardedAction: () => ({ runGuarded: runGuardedMock }),
}));
vi.mock("./abstract-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./abstract-fields")>();
  return {
    ...actual,
    AbstractFields: ({ values, onChange, disabled }: {
      values: typeof actual.EMPTY_ABSTRACT_FIELDS;
      onChange: (next: typeof actual.EMPTY_ABSTRACT_FIELDS) => void;
      disabled?: boolean;
    }) => (
      <input
        aria-label="Session title"
        value={values.title}
        disabled={disabled}
        onChange={(event) => onChange({ ...values, title: event.currentTarget.value })}
      />
    ),
  };
});

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_A = "a6100000-0000-4000-8000-000000000001";
const EVENT_B = "a6100000-0000-4000-8000-000000000002";
const CONTACT_ID = "a6200000-0000-4000-8000-000000000001";
const vocabulary: SubmissionVocabulary = { tracks: [], formats: [], tags: [] };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

async function settle() {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fillTitle(value = "Opening keynote") {
  const title = container.querySelector<HTMLInputElement>('input[aria-label="Session title"]');
  if (!title) throw new Error("expected title input");
  await act(async () => changeInput(title, value));
}

async function startQuickAdd(email = "ada@example.com") {
  await act(async () => buttonNamed("Add a speaker")?.click());
  const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
  if (!emailInput) throw new Error("expected quick-add email input");
  await act(async () => changeInput(emailInput, email));
  await act(async () => buttonNamed("Add speaker")?.click());
}

function speakerCheckbox(name: string): HTMLInputElement | undefined {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find((input) => input.parentElement?.textContent?.includes(name));
}

function Harness({ eventId = EVENT_A }: { eventId?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {!open && <button type="button" onClick={() => setOpen(true)}>Open add submission</button>}
      <AddAbstractDrawer
        eventId={eventId}
        vocabulary={vocabulary}
        timezone="America/Los_Angeles"
        speakers={[]}
        open={open}
        onClose={() => { closeMock(); setOpen(false); }}
      />
    </>
  );
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  closeMock.mockReset();
  runGuardedMock.mockClear();
  unsavedWorkGuardMock.mockClear();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    HTMLDialogElement.prototype.close = function close() { this.open = false; };
  }
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("manual abstract speaker quick-add coordination", () => {
  it("waits for the real quick-add result, then submits that speaker and reopens clean", async () => {
    let resolveSpeaker!: (response: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveSpeaker = resolve; }))
      .mockResolvedValueOnce(Response.json({ data: { submissionId: "submission-1", code: 41 } }));
    await act(async () => root.render(<Harness />));
    await fillTitle();
    await startQuickAdd();

    expect(buttonNamed("Create submission")?.disabled).toBe(true);
    expect(buttonNamed("Cancel")?.disabled).toBe(true);
    expect(container.querySelector('button[aria-label="Close"]')).toBeNull();
    expect(unsavedWorkGuardMock).toHaveBeenLastCalledWith(true, { blocking: true });
    expect(fetchMock).toHaveBeenCalledOnce();

    const dialog = container.querySelector<HTMLDialogElement>("dialog");
    if (!dialog) throw new Error("expected open modal");
    await act(async () => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      buttonNamed("Cancel")?.click();
      buttonNamed("Create submission")?.click();
    });
    expect(closeMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveSpeaker(Response.json({ data: { contact: {
      contactId: CONTACT_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
    } } }));
    await settle();

    expect(speakerCheckbox("Ada Lovelace")?.checked).toBe(true);
    expect(buttonNamed("Create submission")?.disabled).toBe(false);
    expect(buttonNamed("Cancel")?.disabled).toBe(false);
    expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
    expect(unsavedWorkGuardMock).toHaveBeenLastCalledWith(true, { blocking: false });

    await act(async () => buttonNamed("Create submission")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/internal/submissions/${EVENT_A}`);
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      participants: Array<{ contactId: string; role: string; isPrimary: boolean }>;
    };
    expect(body.participants).toEqual([{ contactId: CONTACT_ID, role: "speaker", isPrimary: true }]);
    expect(closeMock).toHaveBeenCalledOnce();
    expect(routerMock.refresh).toHaveBeenCalledOnce();
    expect(buttonNamed("Open add submission")).toBeDefined();

    await act(async () => buttonNamed("Open add submission")?.click());
    await settle();

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Session title"]')?.value).toBe("");
    expect(speakerCheckbox("Ada Lovelace")?.checked).toBe(false);
    expect(buttonNamed("Add a speaker")).toBeDefined();
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')).toBeNull();
    expect(buttonNamed("Create submission")?.disabled).toBe(true);
  });

  it("returns to a truthful editable state when quick-add is rejected", async () => {
    let resolveSpeaker!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveSpeaker = resolve; }));
    await act(async () => root.render(<Harness />));
    await fillTitle();
    await startQuickAdd("invalid@example.com");
    expect(buttonNamed("Create submission")?.disabled).toBe(true);

    resolveSpeaker(Response.json({ error: { message: "That contact could not be added" } }, { status: 422 }));
    await settle();

    expect(container.textContent).toContain("That contact could not be added");
    expect(buttonNamed("Create submission")?.disabled).toBe(false);
    expect(buttonNamed("Cancel")?.disabled).toBe(false);
    expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
    expect(speakerCheckbox("That contact could not be added")).toBeUndefined();
    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
    expect(emailInput?.disabled).toBe(false);
    if (!emailInput) throw new Error("expected editable quick-add email input");
    await act(async () => changeInput(emailInput, "corrected@example.com"));
    expect(emailInput.value).toBe("corrected@example.com");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("drops a pending old-event result without clearing the rest of the draft", async () => {
    let resolveOldSpeaker!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveOldSpeaker = resolve; }));
    await act(async () => root.render(<Harness eventId={EVENT_A} />));
    await fillTitle("Draft kept across authority refresh");
    await startQuickAdd();
    expect(buttonNamed("Create submission")?.disabled).toBe(true);

    await act(async () => root.render(<Harness eventId={EVENT_B} />));
    await settle();

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Session title"]')?.value).toBe("Draft kept across authority refresh");
    expect(buttonNamed("Add a speaker")).toBeDefined();
    expect(buttonNamed("Create submission")?.disabled).toBe(false);
    expect(speakerCheckbox("Ada Lovelace")).toBeUndefined();

    resolveOldSpeaker(Response.json({ data: { contact: {
      contactId: CONTACT_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
    } } }));
    await settle();

    expect(speakerCheckbox("Ada Lovelace")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(closeMock).not.toHaveBeenCalled();
  });
});
