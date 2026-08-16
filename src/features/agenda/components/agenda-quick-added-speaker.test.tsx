/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, type ScheduledSessionDTO, type SessionId } from "@/shared/contracts";
import { settle } from "@tests/support/react";
import { AgendaPage } from "./agenda-page";

/**
 * The just-created session's SPEAKERS column.
 *
 * Speaker *names* are resolved from the event vocabulary the page was
 * server-rendered with, while the session itself arrives through the live
 * session cache the moment it is saved. A speaker created by the dialog's
 * quick-add is in neither until the next navigation, so the row the organizer
 * had just built rendered an em-dash under a name they had typed thirty seconds
 * earlier, and only a full reload fixed it.
 */
const CONTACT_ID = "a5300000-0000-4000-8000-000000000009";

/** Stands in for the sessions query: the save publishes a new list to it. */
const sessions = vi.hoisted(() => {
  let rows: unknown[] = [];
  const listeners = new Set<() => void>();
  return {
    read: () => rows,
    publish: (next: unknown[]) => { rows = next; listeners.forEach((listener) => listener()); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
});

const saveMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("view=list"),
}));
vi.mock("../hooks/use-sessions", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useSessions: () => ({ data: useSyncExternalStore(sessions.subscribe, sessions.read, sessions.read) }) };
});
vi.mock("../hooks/use-agenda-supporting-data", () => ({
  useAcceptedForAgenda: () => ({ data: [] }),
  useAnnounceBundle: () => ({ data: null }),
}));
vi.mock("../hooks/use-session-mutations", () => ({
  useSessionMutations: () => ({
    save: { isPending: false, mutateAsync: saveMock },
    remove: { isPending: false, mutateAsync: vi.fn() },
    restoreContent: { isPending: false, mutateAsync: vi.fn() },
    setPublished: { isPending: false, mutateAsync: vi.fn() },
  }),
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => undefined,
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({
  RichTextEditor: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} readOnly />
  ),
}));
vi.mock("@/shared/ui/app/speaker-quick-add", () => ({
  SpeakerQuickAdd: ({ onAdded }: { onAdded: (speaker: { contactId: string; name: string }) => void }) => (
    <button type="button" onClick={() => onAdded({ contactId: CONTACT_ID, name: "Amara Osei" })}>
      Quick-add Amara
    </button>
  ),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("a5100000-0000-4000-8000-000000000001");

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.replace(/\s+/gu, " ").trim() === name);
}

/** The row cell under the Speakers column, by its header position. */
function speakersCellText(): string | undefined {
  const headers = [...container.querySelectorAll("th")];
  const column = headers.findIndex((header) => header.textContent?.trim().startsWith("Speakers"));
  if (column === -1) return undefined;
  return container.querySelector("tbody tr")?.querySelectorAll("td")[column]?.textContent?.trim();
}

beforeEach(() => {
  sessions.publish([]);
  saveMock.mockReset();
  saveMock.mockImplementation(async (payload: { title: string; speakerContactIds: string[] }) => {
    const created: ScheduledSessionDTO = {
      id: "a5400000-0000-4000-8000-000000000001" as SessionId,
      title: payload.title,
      slug: "new-session",
      descriptionHtml: "",
      startsAt: null,
      endsAt: null,
      trackId: null,
      roomId: null,
      formatId: null,
      status: "draft",
      scheduleRevision: 0,
      rowVersion: 1,
      speakerIds: payload.speakerContactIds as ScheduledSessionDTO["speakerIds"],
    };
    sessions.publish([created]);
  });
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
  vi.restoreAllMocks();
});

describe("a session saved with a speaker created in the same dialog", () => {
  it("names that speaker on the new row without a reload", async () => {
    await act(async () => root.render(
      <AgendaPage
        eventSlug="fresh-event"
        view="list"
        querySeeds={[]}
        eventId={eventId}
        event={{
          timezone: "America/Los_Angeles",
          startsAt: "2026-09-15T16:00:00.000Z",
          endsAt: "2026-09-17T01:00:00.000Z",
        }}
        rooms={[]}
        tracks={[]}
        formats={[]}
        // A fresh event: the server render knows of no contacts at all, which
        // is exactly when an organizer reaches for quick-add.
        speakers={[]}
      />,
    ));
    await settle();

    await act(async () => buttonNamed("Add session")?.click());
    await settle();

    const title = container.querySelector<HTMLInputElement>('input[placeholder="Enter a session title"]');
    expect(title).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(title, "Opening keynote");
      title?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => buttonNamed("Quick-add Amara")?.click());
    await settle();

    await act(async () => buttonNamed("Save session")?.click());
    await settle();

    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Opening keynote",
      speakerContactIds: [CONTACT_ID],
    }));
    expect(speakersCellText()).toBe("Amara Osei");
  });
});
