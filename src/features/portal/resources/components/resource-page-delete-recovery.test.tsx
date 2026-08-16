/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedWorkGuardProvider, useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import type { ResourcePageRow } from "../server/queries";
import { ResourcePagesAdminView } from "./resource-pages-admin-view";
import { settle } from "@tests/support/react";

const fetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/events/one/settings", useRouter: () => ({ push: routerPushMock }) }));
vi.mock("./resource-page-editor", () => ({ ResourcePageEditor: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const page: ResourcePageRow = {
  id: "e6000000-0000-4000-8000-000000000001",
  title: "Speaker guide",
  slug: "speaker-guide",
  summary: "Everything speakers need",
  published: true,
  sortOrder: 0,
  updatedAt: "2026-08-11T00:00:00.000Z",
};
const other: ResourcePageRow = {
  id: "e6000000-0000-4000-8000-000000000002",
  title: "Venue details",
  slug: "venue-details",
  summary: "How to get there",
  published: true,
  sortOrder: 1,
  updatedAt: "2026-08-12T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

function Navigation() {
  const { runGuarded } = useGuardedAction();
  return <button type="button" onClick={() => runGuarded(() => routerPushMock("/events"))}>Leave resources</button>;
}


async function renderView() {
  await act(async () => root.render(
    <UnsavedWorkGuardProvider>
      <Navigation />
      <ResourcePagesAdminView
        eventId="e6000000-0000-4000-8000-000000000010"
        eventSlug="resources-event"
        timezone="America/Los_Angeles"
        initialPages={[page, other]}
      />
    </UnsavedWorkGuardProvider>,
  ));
}

function buttonExact(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function rowFor(title: string): HTMLTableRowElement | undefined {
  return [...container.querySelectorAll<HTMLTableRowElement>("tr")]
    .find((row) => row.textContent?.includes(title));
}

async function beginDelete() {
  await act(async () => rowFor(page.title)?.querySelectorAll<HTMLButtonElement>("button")[3]?.click());
  await act(async () => buttonExact("Delete page")?.click());
  await settle();
}

function okDelete(): Response {
  return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
}

function okList(pages: ResourcePageRow[]): Response {
  return new Response(JSON.stringify({ data: pages }), { status: 200 });
}

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.mockReset();
  routerPushMock.mockReset();
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

describe("resource page deletion recovery", () => {
  it("freezes a lost deletion, blocks navigation and mutations, then replays the exact target before adopting authority", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(okDelete())
      .mockResolvedValueOnce(okList([other]));
    await renderView();
    await beginDelete();

    expect(container.textContent).toContain("Page deletion outcome unconfirmed");
    expect(container.textContent).toContain("We don’t know whether “Speaker guide” was deleted");
    expect(buttonExact("Retry exact deletion")).toBeDefined();
    expect(buttonExact("Check resources")).toBeDefined();
    expect(buttonExact("New page")?.disabled).toBe(true);
    expect(rowFor(other.title)?.querySelectorAll<HTMLButtonElement>("button")[2]?.disabled).toBe(true);
    expect(rowFor(other.title)?.querySelectorAll<HTMLButtonElement>("button")[3]?.disabled).toBe(true);

    await act(async () => buttonExact("Leave resources")?.click());
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(buttonExact("Discard changes")).toBeUndefined();
    expect(buttonExact("Working…")?.disabled).toBe(true);
    await act(async () => buttonExact("Stay here")?.click());

    await act(async () => buttonExact("Retry exact deletion")?.click());
    await settle();

    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/internal/resources/e6000000-0000-4000-8000-000000000010");
    expect(container.textContent).not.toContain("Page deletion outcome unconfirmed");
    expect(container.textContent).not.toContain(page.title);
    expect(container.textContent).toContain(other.title);
    expect(toastMock).toHaveBeenLastCalledWith("Resources checked: “Speaker guide” is not in the current resource list.");
  });

  it("treats malformed success as ambiguous and lets an authoritative Check settle current absence without another delete", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: false } }), { status: 200 }))
      .mockResolvedValueOnce(okList([other]));
    await renderView();
    await beginDelete();

    expect(container.textContent).toContain("Page deletion outcome unconfirmed");
    await act(async () => buttonExact("Check resources")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/internal/resources/e6000000-0000-4000-8000-000000000010");
    expect(container.textContent).not.toContain("Page deletion outcome unconfirmed");
    expect(container.textContent).not.toContain(page.title);
    expect(toastMock).toHaveBeenLastCalledWith("Resources checked: “Speaker guide” is not in the current resource list.");
  });

  it("remains visibly locked through repeated offline Retry and Check attempts", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("still offline"))
      .mockRejectedValueOnce(new TypeError("offline check"));
    await renderView();
    await beginDelete();

    await act(async () => buttonExact("Retry exact deletion")?.click());
    await settle();
    await act(async () => buttonExact("Check resources")?.click());
    await settle();

    expect(container.textContent).toContain("Page deletion outcome unconfirmed");
    expect(container.textContent).toContain(page.title);
    expect(buttonExact("New page")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(
      "Resources still could not be checked. Restore your connection, then retry this exact deletion or check again.",
      { kind: "error" },
    );
  });

  it("keeps the row editable after a definitive rejection and surfaces the server guidance", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: "CONFLICT", message: "This page is required by an active portal task." },
    }), { status: 409 }));
    await renderView();
    await beginDelete();

    expect(container.textContent).not.toContain("Page deletion outcome unconfirmed");
    expect(container.textContent).toContain(page.title);
    expect(buttonExact("New page")?.disabled).toBe(false);
    expect(rowFor(page.title)?.querySelectorAll<HTMLButtonElement>("button")[2]?.disabled).toBe(false);
    expect(rowFor(page.title)?.querySelectorAll<HTMLButtonElement>("button")[3]?.disabled).toBe(false);
    expect(toastMock).toHaveBeenLastCalledWith(
      "This page is required by an active portal task.",
      { kind: "error" },
    );
  });
});
