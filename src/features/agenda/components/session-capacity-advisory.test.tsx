/** @vitest-environment happy-dom */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, roomIdSchema, scheduledSessionDtoSchema, sessionIdSchema, type RoomDTO } from "@/shared/contracts";
import { SessionFormDialog } from "./session-form-dialog";
import { settle } from "@tests/support/react";

/**
 * MTP-07 step 12, asserted the way an organizer meets it: rendered.
 *
 * `room-capacity.test.ts` proves the *sentence* is right and that both manual
 * placement paths call for one. What it could not prove by reading source is
 * the property the feature actually promises — that the advisory is an
 * advisory. A `toContain` on the Save button's `disabled=` expression fails on
 * any innocent refactor of that condition while never once establishing that
 * the button is clickable with a warning on screen. This does, by clicking it.
 */

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => undefined,
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({
  RichTextEditor: ({ value, onChange, ariaLabel }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("@/shared/ui/app/speaker-quick-add", () => ({ SpeakerQuickAdd: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("a6100000-0000-4000-8000-000000000001");
const studio = roomIdSchema.parse("c6000000-0000-4000-8000-000000000001");
const mainStage = roomIdSchema.parse("c6000000-0000-4000-8000-000000000002");

const rooms: RoomDTO[] = [
  { id: studio, name: "Studio", capacity: 60, sortOrder: 0 },
  { id: mainStage, name: "Main Stage", capacity: 1200, sortOrder: 1 },
];

/** A promoted session whose abstract expects an audience of 200, in the 60-seat Studio. */
const session = scheduledSessionDtoSchema.parse({
  id: sessionIdSchema.parse("a6200000-0000-4000-8000-000000000001"),
  title: "Scaling the thing",
  slug: "scaling-the-thing",
  descriptionHtml: "",
  startsAt: "2026-09-16T17:00:00.000Z",
  endsAt: "2026-09-16T18:00:00.000Z",
  trackId: null,
  roomId: studio,
  formatId: null,
  status: "draft",
  scheduleRevision: 0,
  rowVersion: 1,
  speakerIds: [],
  expectedAttendance: 200,
});

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function roomSelect(): HTMLSelectElement {
  const select = [...container.querySelectorAll<HTMLSelectElement>("select")]
    .find((candidate) => [...candidate.options].some((option) => option.textContent === "No room"));
  if (!select) throw new Error("expected the Room select");
  return select;
}

function saveButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === "Save session");
  if (!button) throw new Error("expected the Save session button");
  return button;
}

function advisory(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="status"].agenda-capacity-note');
}

async function renderDialog(sessionProp: typeof session | null): Promise<void> {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <SessionFormDialog
        open
        onClose={() => undefined}
        session={sessionProp}
        defaultDay={null}
        eventId={eventId}
        event={{
          timezone: "America/Los_Angeles",
          startsAt: "2026-09-15T16:00:00.000Z",
          endsAt: "2026-09-17T01:00:00.000Z",
        }}
        rooms={rooms}
        tracks={[]}
        formats={[]}
        speakers={[]}
      />
    </QueryClientProvider>,
  ));
  await settle();
}

beforeEach(() => {
  toastMock.mockReset();
  // The dialog's history panel fetches as soon as an existing session opens;
  // nothing here is about history, so answer it with an empty one.
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ data: { content: [], placements: [] } })));
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

describe("the session dialog's room-capacity advisory", () => {
  it("names the mismatch beside the room, and still lets the organizer save", async () => {
    await renderDialog(session);

    const note = advisory();
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("Studio seats 60, and this session’s abstract expects 200.");
    expect(note?.textContent).toContain("You can still place it here.");
    // Beside the Room control it is about, not adrift at the top of the form.
    expect(roomSelect().closest("label,div,fieldset")?.contains(note as Node)).toBe(true);

    // The property the whole feature rests on: advisory, never a gate. Not a
    // reading of the disabled expression — the button is enabled, and clicking
    // it really does start the save.
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    await settle();
    const saves = vi.mocked(globalThis.fetch).mock.calls
      .filter(([, init]) => (init?.method ?? "GET") !== "GET");
    expect(saves).toHaveLength(1);
  });

  it("goes away when the organizer picks a room that fits", async () => {
    await renderDialog(session);
    expect(advisory()).not.toBeNull();

    const select = roomSelect();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, String(mainStage));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(advisory()).toBeNull();
  });

  it("stays silent for a session the product has no audience estimate for", async () => {
    // Creating a session from scratch: no abstract behind it, so there is no
    // expected attendance to compare and inventing one would be a fiction.
    await renderDialog(null);
    const select = roomSelect();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, String(studio));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(advisory()).toBeNull();
  });
});
