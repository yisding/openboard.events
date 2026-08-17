/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, roomDtoSchema, trackDtoSchema } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { UnsavedWorkGuardProvider } from "@/shared/ui/app/unsaved-work-guard";
import { VocabTab } from "./vocab-tab";

vi.mock("@/shared/lib/api-client", () => ({ api: vi.fn() }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/events/one/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("d3000000-0000-4000-8000-000000000001");
const room = roomDtoSchema.parse({
  id: "d3000000-0000-4000-8000-000000000002",
  name: "Studio",
  capacity: 60,
  sortOrder: 0,
});
const track = trackDtoSchema.parse({
  id: "d3000000-0000-4000-8000-000000000003",
  name: "AI",
  color: "#123456",
  description: null,
  sortOrder: 0,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.mocked(api).mockReset();
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
});

async function openDeleteConfirm(kind: "rooms" | "tracks", item: { id: string; name: string }, initialItems: unknown[]) {
  await act(async () => root.render(
    <UnsavedWorkGuardProvider>
      <VocabTab eventId={eventId} kind={kind} initialItems={initialItems as never} />
    </UnsavedWorkGuardProvider>,
  ));
  const remove = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.getAttribute("aria-label") === `Remove ${item.name}`);
  await act(async () => remove?.click());
}

describe("vocabulary delete confirmation copy", () => {
  it("describes what a room delete actually costs, not the track/format boilerplate", async () => {
    vi.mocked(api).mockResolvedValue({ sessions: 0, publishedSessions: 0, speakers: 0 });
    await openDeleteConfirm("rooms", room, [room]);
    const body = document.querySelector(".long-copy")?.textContent ?? "";

    expect(body).toContain("lose their room assignment");
    expect(body).toContain("schedule revision");
    expect(body).toContain("emailed that the schedule changed");
    // The room copy may name routing rules — but only to say a room is never
    // one, the opposite of the shared boilerplate. What must be gone is the
    // false claim that a submission goes uncategorized or a rule soft-disables.
    expect(body).toContain("never used by submissions or routing rules");
    expect(body).not.toContain("uncategorized");
    expect(body).not.toContain("soft-disabled");
  });

  it("names the sessions and speakers this particular room delete will reach", async () => {
    // #622: the organizer is deciding whether to send mail to real speakers.
    // A generic warning cannot answer that; the count read at open time can.
    vi.mocked(api).mockResolvedValue({ sessions: 3, publishedSessions: 2, speakers: 4 });
    await openDeleteConfirm("rooms", room, [room]);

    expect(vi.mocked(api).mock.calls[0]?.[0]).toBe(`events/${eventId}/vocab/rooms/${room.id}/impact`);
    const body = document.querySelector(".long-copy")?.textContent ?? "";
    expect(body).toContain("3 sessions lose their room");
    expect(body).toContain("2 of them are published");
    expect(body).toContain("4 speakers will be emailed");
  });

  it("says the count could not be read rather than implying there is nothing to lose", async () => {
    vi.mocked(api).mockRejectedValue(new Error("offline"));
    await openDeleteConfirm("rooms", room, [room]);
    const body = document.querySelector(".long-copy")?.textContent ?? "";

    expect(body).toContain("could not be checked");
    expect(body).not.toContain("Nothing is scheduled");
  });

  it("still uses the submissions/routing copy for a track, and asks for no count", async () => {
    await openDeleteConfirm("tracks", track, [track]);
    const body = document.querySelector(".long-copy")?.textContent ?? "";

    expect(body).toContain("uncategorized");
    expect(body).toContain("routing rule");
    expect(body).not.toContain("lose their room assignment");
    expect(api).not.toHaveBeenCalled();
  });
});
