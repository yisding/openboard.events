/** @vitest-environment happy-dom */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { agendaKeys } from "../hooks/keys";
import { SessionFormDialog } from "./session-form-dialog";

const toastMock = vi.hoisted(() => vi.fn());
const runGuardedMock = vi.hoisted(() => vi.fn((action: () => void) => action()));
const quickAddMock = vi.hoisted(() => ({
  add: vi.fn<() => Promise<{ contactId: string; name: string }>>(),
}));

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => undefined,
  useGuardedAction: () => ({ runGuarded: runGuardedMock }),
}));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({
  RichTextEditor: ({ value, onChange, ariaLabel, disabled }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled?: boolean;
  }) => <textarea aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("@/shared/ui/app/speaker-quick-add", () => ({
  SpeakerQuickAdd: ({ disabled, onAdded, onPendingChange }: {
    disabled?: boolean;
    onAdded: (speaker: { contactId: string; name: string }) => void;
    onPendingChange?: (pending: boolean) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onPendingChange?.(true);
        void quickAddMock.add().then(onAdded).finally(() => onPendingChange?.(false));
      }}
    >Add speaker</button>
  ),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("a5100000-0000-4000-8000-000000000001");
const firstCreationId = "a5200000-0000-4000-8000-000000000001" as `${string}-${string}-${string}-${string}-${string}`;
const secondCreationId = "a5200000-0000-4000-8000-000000000002" as `${string}-${string}-${string}-${string}-${string}`;

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

async function settle() {
  await act(async () => {
    for (let step = 0; step < 6; step += 1) await Promise.resolve();
  });
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      {!open && <button type="button" onClick={() => setOpen(true)}>Open session dialog</button>}
      <SessionFormDialog
        open={open}
        onClose={() => setOpen(false)}
        session={null}
        defaultDay={null}
        eventId={eventId}
        event={{
          timezone: "America/Los_Angeles",
          startsAt: "2026-09-15T16:00:00.000Z",
          endsAt: "2026-09-17T01:00:00.000Z",
        }}
        rooms={[]}
        tracks={[]}
        formats={[]}
        speakers={[]}
      />
    </>
  );
}

beforeEach(() => {
  toastMock.mockReset();
  runGuardedMock.mockClear();
  quickAddMock.add.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const ids = [firstCreationId, secondCreationId];
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => ids.shift() ?? secondCreationId);
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
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
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("manual session creation recovery", () => {
  it("locks and replays an ambiguous create exactly, then uses a new id while keeping a definitive error editable", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    let rejectCreate!: (error: unknown) => void;
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((_resolve, reject) => { rejectCreate = reject; }))
      .mockResolvedValueOnce(Response.json({ data: {
        id: firstCreationId,
        title: "Opening keynote",
        slug: "opening-keynote",
        descriptionHtml: "",
        startsAt: null,
        endsAt: null,
        trackId: null,
        roomId: null,
        formatId: null,
        status: "draft",
        scheduleRevision: 0,
        rowVersion: 1,
        speakerIds: [],
      } }))
      .mockResolvedValueOnce(Response.json({
        error: { code: "VALIDATION", message: "Session title is not allowed" },
      }, { status: 400 }));

    await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>));
    await settle();

    const title = container.querySelector<HTMLInputElement>('input[placeholder="Enter a session title"]');
    if (!title) throw new Error("expected title input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Opening keynote");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonNamed("Save session")?.click());

    expect(title.closest("fieldset")?.disabled).toBe(true);
    await act(async () => {
      // Model a user edit: disabled fieldset descendants never receive an
      // editable input event. Directly assigning `.value` would mutate the
      // happy-dom node in a way a browser user cannot.
      if (!title.closest("fieldset")?.disabled) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Changed while pending");
        title.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(title.value).toBe("Opening keynote");

    rejectCreate(new TypeError("response lost"));
    await settle();

    expect(container.textContent).toContain("We could not confirm whether this session was created");
    expect(title.closest("fieldset")?.disabled).toBe(true);
    expect(title.value).toBe("Opening keynote");
    expect(buttonNamed("Retry creation")).toBeDefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: agendaKeys.allSessions(eventId) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: agendaKeys.announceBundle(eventId) });
    expect(invalidate).toHaveBeenCalledTimes(2);
    const firstBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(firstBody)).toMatchObject({ creationId: firstCreationId, title: "Opening keynote" });

    await act(async () => buttonNamed("Retry creation")?.click());
    await settle();

    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toBe(firstBody);
    expect(buttonNamed("Open session dialog")).toBeDefined();
    expect(invalidate).toHaveBeenCalledTimes(4);
    expect(toastMock).toHaveBeenCalledWith("Session created");

    await act(async () => buttonNamed("Open session dialog")?.click());
    await settle();
    const secondTitle = container.querySelector<HTMLInputElement>('input[placeholder="Enter a session title"]');
    if (!secondTitle) throw new Error("expected reopened title input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(secondTitle, "Follow-up session");
      secondTitle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonNamed("Save session")?.click());
    await settle();

    const secondBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as { creationId: string };
    expect(secondBody.creationId).toBe(secondCreationId);
    expect(secondBody.creationId).not.toBe(firstCreationId);
    expect(container.textContent).toContain("Session title is not allowed");
    expect(secondTitle.closest("fieldset")?.disabled).toBe(false);
    expect(buttonNamed("Retry creation")).toBeUndefined();

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(secondTitle, "Editable after rejection");
      secondTitle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(secondTitle.value).toBe("Editable after rejection");
  });

  it("keeps a retry conflict locked and lets the explicit recovery escape close without a second discard prompt", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json({
        error: { code: "CONFLICT", message: "This creation attempt was already used for different session details" },
      }, { status: 409 }));

    await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>));
    await settle();
    const title = container.querySelector<HTMLInputElement>('input[placeholder="Enter a session title"]');
    if (!title) throw new Error("expected title input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Conflicting retry");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonNamed("Save session")?.click());
    await settle();
    await act(async () => buttonNamed("Retry creation")?.click());
    await settle();

    expect(container.textContent).toContain("This creation attempt was already used for different session details");
    expect(title.closest("fieldset")?.disabled).toBe(true);
    expect(buttonNamed("Close and check agenda")).toBeDefined();

    await act(async () => buttonNamed("Close and check agenda")?.click());
    expect(runGuardedMock).not.toHaveBeenCalled();
    expect(buttonNamed("Open session dialog")).toBeDefined();
  });

  it("waits for quick-add, then freezes and retries the payload with the selected speaker", async () => {
    const addedContactId = "a5300000-0000-4000-8000-000000000001";
    let resolveQuickAdd!: (speaker: { contactId: string; name: string }) => void;
    quickAddMock.add.mockReturnValueOnce(new Promise((resolve) => { resolveQuickAdd = resolve; }));
    fetchMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json({ data: {
        id: firstCreationId,
        title: "Speaker-safe session",
        slug: "speaker-safe-session",
        descriptionHtml: "",
        startsAt: null,
        endsAt: null,
        trackId: null,
        roomId: null,
        formatId: null,
        status: "draft",
        scheduleRevision: 0,
        rowVersion: 1,
        speakerIds: [addedContactId],
      } }));

    await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>));
    await settle();
    const title = container.querySelector<HTMLInputElement>('input[placeholder="Enter a session title"]');
    if (!title) throw new Error("expected title input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Speaker-safe session");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => buttonNamed("Add speaker")?.click());
    expect(buttonNamed("Save session")?.disabled).toBe(true);
    expect(buttonNamed("Cancel")?.disabled).toBe(true);
    await act(async () => buttonNamed("Save session")?.click());
    expect(fetchMock).not.toHaveBeenCalled();

    resolveQuickAdd({ contactId: addedContactId, name: "Ada Lovelace" });
    await settle();

    const addedSpeaker = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Ada Lovelace"));
    expect(addedSpeaker?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(buttonNamed("Save session")?.disabled).toBe(false);

    await act(async () => buttonNamed("Save session")?.click());
    await settle();

    const firstBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(firstBody)).toMatchObject({
      creationId: firstCreationId,
      title: "Speaker-safe session",
      speakerContactIds: [addedContactId],
    });
    expect(buttonNamed("Retry creation")).toBeDefined();

    await act(async () => buttonNamed("Retry creation")?.click());
    await settle();

    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toBe(firstBody);
    expect(buttonNamed("Open session dialog")).toBeDefined();
  });
});
