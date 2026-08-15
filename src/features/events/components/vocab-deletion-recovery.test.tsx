/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, trackDtoSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { UnsavedWorkGuardProvider, useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import { VocabTab } from "./vocab-tab";
import { settle } from "@tests/support/react";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPushMock, refresh: routerRefreshMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("d2000000-0000-4000-8000-000000000001");
const track = trackDtoSchema.parse({
  id: "d2000000-0000-4000-8000-000000000002",
  name: "AI",
  color: "#123456",
  description: null,
  sortOrder: 0,
});
const other = trackDtoSchema.parse({
  id: "d2000000-0000-4000-8000-000000000003",
  name: "Security",
  color: "#654321",
  description: null,
  sortOrder: 1,
});

let container: HTMLDivElement;
let root: Root;

function Navigation() {
  const { runGuarded } = useGuardedAction();
  return <button type="button" onClick={() => runGuarded(() => routerPushMock("/events"))}>Leave settings</button>;
}


async function renderTab() {
  await act(async () => root.render(
    <UnsavedWorkGuardProvider>
      <Navigation />
      <VocabTab eventId={eventId} kind="tracks" initialItems={[track, other]} />
    </UnsavedWorkGuardProvider>,
  ));
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim().includes(name) || button.getAttribute("aria-label")?.includes(name));
}

async function beginDelete() {
  await act(async () => buttonNamed("Remove AI")?.click());
  await act(async () => buttonNamed("Delete")?.click());
  await settle();
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  routerPushMock.mockReset();
  routerRefreshMock.mockReset();
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

describe("vocabulary deletion recovery", () => {
  it("freezes a lost deletion, blocks navigation/mutations, and replays it before adopting authority", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce([other]);
    await renderTab();
    await beginDelete();

    expect(container.textContent).toContain("Deletion outcome unconfirmed");
    expect(container.textContent).toContain("We don’t know whether AI was deleted");
    expect(buttonNamed("Retry exact deletion")).toBeDefined();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')?.disabled).toBe(true);
    expect(buttonNamed("Add")?.disabled).toBe(true);
    await act(async () => buttonNamed("Leave settings")?.click());
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(buttonNamed("Discard changes")).toBeUndefined();
    await act(async () => buttonNamed("Stay here")?.click());

    await act(async () => buttonNamed("Retry exact deletion")?.click());
    await settle();

    expect(apiMock.mock.calls[1]).toEqual(apiMock.mock.calls[0]);
    expect(apiMock.mock.calls[2]?.[0]).toBe(`events/${eventId}/vocab/tracks`);
    expect(container.textContent).not.toContain("Deletion outcome unconfirmed");
    expect(buttonNamed("Remove AI")).toBeUndefined();
    expect(buttonNamed("Remove Security")).toBeDefined();
  });

  it("treats malformed success as ambiguous and remains locked through repeated offline replay", async () => {
    apiMock
      .mockRejectedValueOnce(new AppError("INTERNAL", "Unexpected API response (200)"))
      .mockRejectedValueOnce(new TypeError("offline"));
    await renderTab();
    await beginDelete();
    await act(async () => buttonNamed("Retry exact deletion")?.click());
    await settle();

    expect(apiMock.mock.calls[1]).toEqual(apiMock.mock.calls[0]);
    expect(container.textContent).toContain("Deletion outcome unconfirmed");
    expect(buttonNamed("Retry exact deletion")).toBeDefined();
    expect(buttonNamed("Remove Security")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(
      "The deletion is still unconfirmed. Restore your connection, then retry this exact deletion.",
      { kind: "error" },
    );
  });

  it("keeps a dependency conflict visible and editable after authoritative reload", async () => {
    apiMock
      .mockRejectedValueOnce(new AppError("CONFLICT", "This track is still used by forms “Main CFP”. Remove it there before deleting it."))
      .mockResolvedValueOnce([{ ...track, name: "AI Systems" }, other]);
    await renderTab();
    await beginDelete();

    expect(container.textContent).not.toContain("Deletion outcome unconfirmed");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')?.value).toBe("AI Systems");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')?.disabled).toBe(false);
    expect(buttonNamed("Remove AI Systems")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenLastCalledWith(
      "This track is still used by forms “Main CFP”. Remove it there before deleting it.",
      { kind: "error" },
    );
  });
});
