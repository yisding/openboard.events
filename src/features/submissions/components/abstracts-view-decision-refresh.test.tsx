/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contactIdSchema, eventIdSchema, submissionIdSchema, type SubmissionListRow, type SubmissionStatus } from "@/shared/contracts";
import { AbstractsView } from "./abstracts-view";

// `router.refresh()` is a no-op here on purpose: it is exactly what the
// organizer saw in the browser — the call is made, no new server data reaches
// the already-rendered client tree, and the row has to be right anyway.
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const id = (suffix: string) => submissionIdSchema.parse(`e5000000-0000-4000-8000-0000000000${suffix}`);

const ROW: SubmissionListRow = {
  submissionId: id("01"),
  code: 101,
  status: "pending",
  source: "cfp",
  formId: null,
  formName: null,
  title: "Agents in production",
  descriptionPlain: null,
  submitterEmail: "speaker@example.com",
  submitterName: "Speaker One",
  speakers: [{ contactId: contactIdSchema.parse(id("02")), name: "Speaker One", isPrimary: true }],
  trackId: null,
  trackName: null,
  trackColor: null,
  tags: [],
  rating: null,
  nScores: 0,
  notifiedAt: null,
  submittedAt: "2026-08-01T12:00:00.000Z",
  createdAt: "2026-08-01T12:00:00.000Z",
  formatName: null,
  language: "en",
  level: null,
  capacity: null,
  clientSessionId: null,
  rowVersion: 1,
};

const COUNTS: Record<SubmissionStatus | "all", number> = {
  all: 1,
  draft: 0,
  pending: 1,
  accept_queue: 0,
  decline_queue: 0,
  accepted: 0,
  declined: 0,
  withdrawn: 0,
};

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function readyToNotifyTab(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.getAttribute("aria-label")?.startsWith("Ready to notify"));
}

beforeEach(() => {
  navigation.refresh.mockReset();
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderView() {
  await act(async () => root.render(
    <AbstractsView
      eventId={eventIdSchema.parse(id("04"))}
      rows={[ROW]}
      counts={COUNTS}
      view="all"
      status="all"
      search=""
      timezone="America/Los_Angeles"
      total={1}
      filteredTotal={1}
      page={1}
      pageSize={25}
      sort="newest"
      queued={0}
      vocabulary={{ tracks: [], formats: [], tags: [] }}
      speakers={[]}
      canEdit
    />,
  ));
}

describe("Submissions list after a bulk decision", () => {
  it("shows the moved status and the new queue counts without a reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: { changed: [ROW.submissionId], stale: [], unpublished: 0 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    await renderView();

    const select = container.querySelector<HTMLInputElement>('input[aria-label="Select SESS-101, Agents in production"]');
    if (!select) throw new Error("Row selection checkbox was not rendered");
    await act(async () => select.click());

    expect(container.textContent).toContain("Pending review");
    expect(readyToNotifyTab()?.getAttribute("aria-label")).toContain("0 submissions");

    await act(async () => {
      buttonNamed("Move to accept queue")?.click();
      await Promise.resolve();
    });

    expect(toastMock).toHaveBeenCalledWith("1 moved");
    expect(container.textContent).toContain("Queued to accept");
    expect(container.textContent).not.toContain("Pending review");
    expect(readyToNotifyTab()?.getAttribute("aria-label")).toContain("1 submission,");
    expect(container.textContent).toContain("1 decision email is ready to send");
    // The server snapshot is still requested — it just is not what the
    // organizer has to wait for to believe the toast.
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("leaves a row the server refused to move showing its real status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: { changed: [], stale: [ROW.submissionId], unpublished: 0 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    await renderView();

    const select = container.querySelector<HTMLInputElement>('input[aria-label="Select SESS-101, Agents in production"]');
    if (!select) throw new Error("Row selection checkbox was not rendered");
    await act(async () => select.click());

    await act(async () => {
      buttonNamed("Move to accept queue")?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Pending review");
    expect(readyToNotifyTab()?.getAttribute("aria-label")).toContain("0 submissions");
  });
});
