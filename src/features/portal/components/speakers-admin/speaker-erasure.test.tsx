/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakerDetailDTO } from "@/features/portal";
import type { ContactId } from "@/shared/contracts";
import { SpeakerDetailView } from "./speaker-detail-view";

const harness = vi.hoisted(() => ({ toast: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.push, refresh: harness.refresh }) }));
vi.mock("@/shared/ui/app/file-upload", () => ({ FileUpload: () => null }));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({ RichTextEditor: () => null }));
vi.mock("@/shared/ui/app/tz-time", () => ({ TzTime: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "e0000000-0000-4000-8000-000000000001";
const contactId = "e0000000-0000-4000-8000-000000000002" as ContactId;

function detail(): SpeakerDetailDTO {
  return {
    contact: {
      contactId,
      name: "Ada Lovelace",
      email: "ada@example.com",
      jobTitle: null,
      company: null,
      headshotFileId: null,
      confirmationStatus: "confirmed",
      isAcceptedSpeaker: true,
      submissionCount: 0,
      openTasks: 0,
      overdueTasks: 0,
      missingBio: false,
      missingHeadshot: false,
      bioHtml: null,
      pronouns: null,
      gender: null,
      salutation: null,
      links: { linkedin: null, twitter: null, facebook: null, website: null },
      unsubscribedAt: null,
    },
    submissions: [],
    tasks: [],
    comms: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function nameConfirmInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("input[aria-label=\"Confirm erasure by typing the speaker’s name\"]");
  if (!input) throw new Error("Missing erase confirmation input");
  return input;
}

async function flush() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  harness.toast.mockReset();
  harness.push.mockReset();
  harness.refresh.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<SpeakerDetailView eventId={eventId} timezone="UTC" initialDetail={detail()} />));
}

describe("erasing a speaker", () => {
  it("names what erasure destroys and requires the speaker's name before it can run", async () => {
    await render();

    await act(async () => button("Erase this speaker").click());

    const dialog = document.body.textContent ?? "";
    expect(dialog).toContain("Erase Ada Lovelace?");
    // Event-scoped personal data is deleted, and their name is anonymized where
    // it lingers elsewhere (file comments on other slots, submissions they entered).
    expect(dialog).toContain("anonymized");
    // Blocking fix (PR #608): the CRM half must state the *actual* outcome of
    // `eraseContactDataIn` step 5 — a hard delete when the organizer administers
    // the org, retained-intact otherwise — never "retained but anonymized".
    expect(dialog).toContain("if you administer it, the CRM profile and its notes, pipeline, tags and merge history are permanently deleted");
    expect(dialog).toContain("if you do not, that CRM profile is left intact");
    expect(dialog).not.toContain("retained but anonymized");
    expect(dialog).toContain("cannot be undone");
    // Deliberate confirmation (design bar D4): nothing is destroyable until the
    // exact name is typed.
    expect(button("Erase permanently").disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels without deleting anything", async () => {
    await render();

    await act(async () => button("Erase this speaker").click());
    await act(async () => button("Cancel").click());
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Erase Ada Lovelace?");
  });

  it("deletes through the erasure endpoint and returns to the roster once the name matches", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { eventId, contactId, erasedAt: new Date().toISOString(), deletedCounts: {} } }));
    await render();

    await act(async () => button("Erase this speaker").click());
    const input = nameConfirmInput();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Ada Lovelace");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Erase permanently").click());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/internal/speakers/${eventId}/${contactId}`);
    expect(init.method).toBe("DELETE");
    expect(harness.push).toHaveBeenCalledWith(`/events/${eventId}/speakers`);
    expect(harness.toast).toHaveBeenCalledWith("Ada Lovelace has been erased");
  });
});
