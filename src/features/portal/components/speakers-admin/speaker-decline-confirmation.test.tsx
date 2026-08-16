/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakerDetailDTO } from "@/features/portal";
import type { ConfirmationStatus, ContactId } from "@/shared/contracts";
import { SpeakerDetailView } from "./speaker-detail-view";

const harness = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/shared/ui/app/file-upload", () => ({ FileUpload: () => null }));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({ RichTextEditor: () => null }));
vi.mock("@/shared/ui/app/tz-time", () => ({ TzTime: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "e0000000-0000-4000-8000-000000000001";
const contactId = "e0000000-0000-4000-8000-000000000002" as ContactId;

function detailWith(confirmationStatus: ConfirmationStatus): SpeakerDetailDTO {
  return {
    contact: {
      contactId,
      name: "Ada Lovelace",
      email: "ada@example.com",
      jobTitle: null,
      company: null,
      headshotFileId: null,
      confirmationStatus,
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

async function flush() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function render(confirmationStatus: ConfirmationStatus) {
  await act(async () => root.render(
    <SpeakerDetailView eventId={eventId} timezone="UTC" initialDetail={detailWith(confirmationStatus)} />,
  ));
}

beforeEach(() => {
  harness.toast.mockReset();
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

describe("declining a confirmed speaker", () => {
  it("asks first and names what the speaker loses in public, writing nothing until confirmed", async () => {
    await render("confirmed");

    await act(async () => button("Declined").click());

    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = document.body.textContent ?? "";
    expect(dialog).toContain("Decline Ada Lovelace?");
    expect(dialog).toContain("public speaker gallery");
    expect(dialog).toContain("published session");
  });

  it("cancels back to the unchanged status", async () => {
    await render("confirmed");

    await act(async () => button("Declined").click());
    await act(async () => button("Cancel").click());
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Decline Ada Lovelace?");
  });

  it("patches the speaker once the organizer confirms", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: detailWith("declined") }));
    await render("confirmed");

    await act(async () => button("Declined").click());
    await act(async () => button("Decline speaker").click());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ confirmationStatus: "declined" });
    expect(harness.toast).toHaveBeenCalledWith("Confirmation set to declined — removed from the public gallery");
  });

  it("leaves the non-destructive transitions one click, including declining a speaker who never confirmed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: detailWith("declined") }));
    await render("unconfirmed");

    await act(async () => button("Declined").click());
    await flush();

    expect(document.body.textContent).not.toContain("Decline Ada Lovelace?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
