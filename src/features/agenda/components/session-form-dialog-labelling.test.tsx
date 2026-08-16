/** @vitest-environment happy-dom */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventIdSchema,
  roomIdSchema,
  scheduledSessionDtoSchema,
  sessionIdSchema,
  type RoomDTO,
} from "@/shared/contracts";
import { SessionFormDialog } from "./session-form-dialog";
import { settle } from "@tests/support/react";

/**
 * Every control the session dialog edits, held to the rule PR #595 set for the
 * abstract drawer.
 *
 * Chrome's accessibility panel found the dialog's fields anonymous: no `id`,
 * no `name` — the title input, the format/track/room selects, the date pickers
 * and the status select — and the count grew every time the dialog was opened.
 * This walks the rendered form the way a screen reader or an autofill heuristic
 * does rather than asserting one component's markup, so a field added later is
 * held to the same rule.
 */

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => undefined,
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({
  RichTextEditor: ({ ariaLabel }: { ariaLabel: string }) => (
    <div className="rich-text-editor">
      <div role="toolbar" aria-label="Formatting"><button type="button" aria-label="Bold">B</button></div>
      <div role="textbox" aria-multiline="true" aria-label={ariaLabel} />
    </div>
  ),
}));
vi.mock("@/shared/ui/app/speaker-quick-add", () => ({ SpeakerQuickAdd: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("a6100000-0000-4000-8000-000000000001");
const studio = roomIdSchema.parse("c6000000-0000-4000-8000-000000000001");

const rooms: RoomDTO[] = [{ id: studio, name: "Studio", capacity: 60, sortOrder: 0 }];

/** A scheduled session, so the Starts/Ends pickers are on screen too. */
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
  expectedAttendance: null,
});

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function controls(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("input, select, textarea")];
}

/** The accessible name a browser would compute for this control, or "". */
function accessibleName(control: HTMLElement): string {
  const aria = control.getAttribute("aria-label");
  if (aria) return aria;
  const labelled = control.id
    ? container.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(control.id)}"]`)
    : null;
  const label = labelled ?? control.closest("label");
  return (label?.querySelector("span") ?? label)?.textContent?.trim() ?? "";
}

function controlLabelled(text: string): HTMLElement | undefined {
  return controls().find((control) => accessibleName(control).replace(/\s*\*$/u, "") === text);
}

async function renderDialog(): Promise<void> {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <SessionFormDialog
        open
        onClose={() => undefined}
        session={session}
        defaultDay={null}
        onSpeakerAdded={() => undefined}
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

describe("the session dialog's form", () => {
  it("gives every control a name a form tool can read and a label a person can", async () => {
    await renderDialog();
    expect(controls().length).toBeGreaterThan(4);
    const anonymous = controls()
      .filter((control) => accessibleName(control) === "" || (control.getAttribute("name") ?? control.id) === "")
      .map((control) => control.outerHTML);

    expect(anonymous).toEqual([]);
  });

  it("points each label at its own control instead of whatever is nested first", async () => {
    await renderDialog();
    expect(controlLabelled("Session title")?.getAttribute("name")).toBe("title");
    expect(controlLabelled("Format")?.tagName).toBe("SELECT");
    expect(controlLabelled("Room")?.getAttribute("name")).toBe("roomId");
    expect(controlLabelled("Status")?.getAttribute("name")).toBe("status");
    // The date picker puts a calendar button beside its input, so the label is
    // written to name the input rather than left to find it by position.
    const starts = controlLabelled("Starts");
    expect(starts?.tagName).toBe("INPUT");
    expect(container.querySelector(`label[for="${CSS.escape(starts?.id ?? "")}"]`)).not.toBeNull();
  });
});
