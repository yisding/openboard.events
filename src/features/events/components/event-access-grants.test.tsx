/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, userIdSchema, type EventAccessOverviewDTO } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { EventAccessTab } from "./event-access-tab";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("c4300000-0000-4000-8000-000000000071");
const candidateId = userIdSchema.parse("c4300000-0000-4000-8000-000000000072");
const overview: EventAccessOverviewDTO = {
  members: [{
    userId: userIdSchema.parse("c4300000-0000-4000-8000-000000000073"),
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    organizationMember: true,
    canRemove: false,
  }],
  candidates: [{
    userId: candidateId,
    email: "alex@example.com",
    name: "Alex Speaker",
    organizationRole: "reviewer",
  }, {
    userId: userIdSchema.parse("c4300000-0000-4000-8000-000000000074"),
    email: "blair@example.com",
    name: "Blair Organizer",
    organizationRole: "organizer",
  }],
  canGrant: true,
  grantRestriction: null,
};

let container: HTMLDivElement;
let root: Root;

async function renderAccess() {
  await act(async () => {
    root.render(<EventAccessTab eventId={eventId} />);
    await Promise.resolve();
  });
}

function buttonNamed(name: string, within: ParentNode = container): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim().includes(name));
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
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

describe("Event Settings access grants", () => {
  it("searches teammates, grants inline, and updates the roster without a reload", async () => {
    apiMock.mockResolvedValueOnce(overview).mockResolvedValueOnce({
      userId: candidateId,
      email: "alex@example.com",
      name: "Alex Speaker",
      role: "organizer",
      organizationMember: true,
      canRemove: true,
    });
    await renderAccess();

    await act(async () => buttonNamed("Grant access")?.click());
    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    const search = dialog?.querySelector<HTMLInputElement>('input[placeholder="Search by name or email"]');
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "alex");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dialog?.textContent).toContain("Alex Speaker");
    expect(dialog?.textContent).not.toContain("Blair Organizer");

    await act(async () => buttonNamed("Alex Speaker", dialog ?? container)?.click());
    const role = dialog?.querySelector<HTMLSelectElement>("select");
    await act(async () => {
      if (!role) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(role, "organizer");
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.click());

    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("Alex Speaker");
    expect(apiMock).toHaveBeenNthCalledWith(2,
      `events/${eventId}/access/${candidateId}`,
      expect.anything(),
      { method: "PATCH", body: { role: "organizer" } },
    );
    expect(toastMock).toHaveBeenCalledWith("Alex Speaker can now open this event as organizer");
  });

  it("explains event-only organizer permissions without showing a dead control", async () => {
    apiMock.mockResolvedValueOnce({
      ...overview,
      candidates: [],
      canGrant: false,
      grantRestriction: "Granting requires organizer access to both this event and its organization. Ask an organization owner or organizer who also organizes this event.",
    });
    await renderAccess();

    expect(container.textContent).toContain("organizer access to both this event and its organization");
    expect(buttonNamed("Grant access")).toBeUndefined();
  });

  it("recovers the overview after its initial request fails", async () => {
    apiMock.mockRejectedValueOnce(new AppError("INTERNAL", "Connection lost")).mockResolvedValueOnce(overview);
    await renderAccess();

    expect(container.textContent).toContain("Connection lost");
    await act(async () => buttonNamed("Retry")?.click());

    expect(buttonNamed("Grant access")).toBeDefined();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
