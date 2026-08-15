/** @vitest-environment happy-dom */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, sessionIdSchema, type ScheduledSessionDTO } from "@/shared/contracts";
import { ListView } from "./list-view";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("a5100000-0000-4000-8000-000000000001");

function session(id: string, title: string, scheduled: boolean, status: "draft" | "published" = "draft"): ScheduledSessionDTO {
  return {
    id: sessionIdSchema.parse(id),
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    descriptionHtml: "",
    startsAt: scheduled ? "2026-09-15T17:00:00.000Z" : null,
    endsAt: scheduled ? "2026-09-15T18:00:00.000Z" : null,
    trackId: null,
    roomId: null,
    formatId: null,
    status,
    scheduleRevision: 0,
    rowVersion: 1,
    speakerIds: [],
  };
}

const sessions: ScheduledSessionDTO[] = [
  session("a5200000-0000-4000-8000-000000000001", "Opening keynote", true),
  session("a5200000-0000-4000-8000-000000000002", "Panel discussion", true),
  session("a5200000-0000-4000-8000-000000000003", "Closing remarks", true),
  session("a5200000-0000-4000-8000-000000000004", "Unscheduled lightning talk", false),
];

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

function checkboxNamed(name: string): HTMLInputElement | undefined {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find((input) => input.getAttribute("aria-label") === name);
}

beforeEach(() => {
  toastMock.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
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

describe("ListView bulk publish", () => {
  it("opens the confirm dialog and publishes after selecting only valid rows, even after a prior validation failure", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { changed: 3, emailsQueued: 0 } }));

    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <ListView
          eventId={eventId}
          event={{ timezone: "America/Los_Angeles", startsAt: "2026-09-15T16:00:00.000Z", endsAt: "2026-09-17T01:00:00.000Z" }}
          sessions={sessions}
          conflicts={[]}
          rooms={[]}
          tracks={[]}
          formats={[]}
          speakers={[]}
          accepted={[]}
        />
      </QueryClientProvider>,
    ));
    await settle();

    // Step 1: select everything, including the unscheduled row — expect the
    // validation toast, no dialog, no fetch.
    const selectAll = checkboxNamed("Select every row on this page");
    if (!selectAll) throw new Error("expected select-all checkbox");
    await act(async () => selectAll.click());
    await settle();
    await act(async () => buttonNamed("Publish selected")?.click());
    await settle();

    expect(toastMock).toHaveBeenCalledWith(
      "Schedule 1 selected session before publishing",
      { kind: "error" },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buttonNamed("Publish sessions")).toBeUndefined();

    // Step 2: clear, then select only the three already-scheduled rows.
    await act(async () => buttonNamed("Clear")?.click());
    await settle();

    for (const title of ["Opening keynote", "Panel discussion", "Closing remarks"]) {
      const checkbox = checkboxNamed(`Select ${title}`);
      if (!checkbox) throw new Error(`expected checkbox for ${title}`);
      await act(async () => checkbox.click());
      await settle();
    }

    await act(async () => buttonNamed("Publish selected")?.click());
    await settle();

    // The confirm dialog must actually stay open — this is the regression:
    // an unstable `onSelectionChange` closure previously re-fired on every
    // re-render and reset `pendingPublish` back to null before it could render.
    expect(container.textContent).toContain("Publish 3 sessions?");
    const confirmButton = buttonNamed("Publish sessions");
    if (!confirmButton) throw new Error("expected confirm dialog publish button");

    await act(async () => confirmButton.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toContain("agenda/sessions/bulk-publish");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ published: true });
  });
});
