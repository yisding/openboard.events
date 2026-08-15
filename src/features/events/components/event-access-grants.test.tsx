/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, userIdSchema, type EventAccessOverviewDTO } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { UnsavedWorkGuardProvider, useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import { EventAccessTab } from "./event-access-tab";
import { settle } from "@tests/support/react";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPushMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("c4300000-0000-4000-8000-000000000071");
const candidateId = userIdSchema.parse("c4300000-0000-4000-8000-000000000072");
const formerMemberId = userIdSchema.parse("c4300000-0000-4000-8000-000000000075");
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

const grantedMember = {
  userId: candidateId,
  email: "alex@example.com",
  name: "Alex Speaker",
  role: "organizer" as const,
  organizationMember: true,
  canRemove: true,
};
const grantedOverview: EventAccessOverviewDTO = {
  ...overview,
  members: [...overview.members, grantedMember],
  candidates: overview.candidates.filter((candidate) => candidate.userId !== candidateId),
};
const formerMember = {
  userId: formerMemberId,
  email: "former@example.com",
  name: "Former Organizer",
  role: "organizer" as const,
  organizationMember: false,
  canRemove: true,
};
const removalOverview: EventAccessOverviewDTO = {
  ...overview,
  members: [...overview.members, formerMember],
};
const removedOverview: EventAccessOverviewDTO = {
  ...removalOverview,
  members: overview.members,
};

let container: HTMLDivElement;
let root: Root;

function TestNavigation() {
  const { runGuarded } = useGuardedAction();
  return <button type="button" onClick={() => runGuarded(() => routerPushMock("/events"))}>Switch settings tab</button>;
}

async function renderAccess() {
  await act(async () => {
    root.render(
      <UnsavedWorkGuardProvider>
        <TestNavigation />
        <EventAccessTab eventId={eventId} />
      </UnsavedWorkGuardProvider>,
    );
  });
  await settle();
}


function buttonNamed(name: string, within: ParentNode = container): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim().includes(name));
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  routerPushMock.mockReset();
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
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "blair");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.disabled).toBe(true);
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "alex");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
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

  it("freezes and causally replays a lost grant before adopting the authoritative roster", async () => {
    apiMock
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(grantedMember)
      .mockResolvedValueOnce(grantedOverview);
    await renderAccess();

    await act(async () => buttonNamed("Grant access")?.click());
    const dialog = container.querySelector("dialog");
    await act(async () => buttonNamed("Alex Speaker", dialog ?? container)?.click());
    const role = dialog?.querySelector<HTMLSelectElement>("select");
    await act(async () => {
      if (!role) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(role, "organizer");
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.click());
    await settle();

    expect(container.textContent).toContain("Event access change unconfirmed");
    expect(container.textContent).toContain("We don’t know whether alex@example.com currently has the requested access.");
    expect(buttonNamed("Grant access")?.disabled).toBe(true);
    expect(buttonNamed("Retry exact grant")).toBeDefined();
    expect(buttonNamed("Check event access")).toBeDefined();

    await act(async () => buttonNamed("Switch settings tab")?.click());
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(buttonNamed("Discard changes")).toBeUndefined();
    expect(buttonNamed("Working…")?.disabled).toBe(true);
    await act(async () => buttonNamed("Stay here")?.click());

    await act(async () => buttonNamed("Retry exact grant")?.click());
    await settle();

    expect(apiMock.mock.calls[2]).toEqual(apiMock.mock.calls[1]);
    expect(apiMock.mock.calls[3]?.[0]).toBe(`events/${eventId}/access`);
    expect(container.textContent).not.toContain("Event access change unconfirmed");
    expect(container.textContent).toContain("Alex Speaker");
    expect(toastMock).toHaveBeenLastCalledWith(
      "Event access checked: alex@example.com currently has organizer access to this event.",
    );
  });

  it("replays a lost former-member removal and accepts the canonical absent result", async () => {
    apiMock
      .mockResolvedValueOnce(removalOverview)
      .mockRejectedValueOnce(new Error("malformed success envelope"))
      .mockResolvedValueOnce({ removed: true })
      .mockResolvedValueOnce(removedOverview);
    await renderAccess();

    const formerRow = [...container.querySelectorAll("article")]
      .find((row) => row.textContent?.includes("Former Organizer"));
    await act(async () => formerRow?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .findLast((button) => button.textContent?.includes("Remove event access"))?.click());
    await settle();

    expect(container.textContent).toContain("Event access change unconfirmed");
    expect(container.textContent).toContain("No longer in this organization");
    expect(buttonNamed("Grant access")?.disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent?.includes("Remove access"))
      .every((button) => button.disabled)).toBe(true);

    await act(async () => buttonNamed("Retry exact removal")?.click());
    await settle();

    expect(apiMock.mock.calls[2]).toEqual(apiMock.mock.calls[1]);
    expect(apiMock.mock.calls[3]?.[0]).toBe(`events/${eventId}/access`);
    expect(container.textContent).not.toContain("Former Organizer");
    expect(toastMock).toHaveBeenLastCalledWith(
      "Event access checked: former@example.com currently has no access to this event.",
    );
  });

  it("stays visibly locked through repeated offline replay and check attempts", async () => {
    apiMock
      .mockResolvedValueOnce(removalOverview)
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new AppError("INTERNAL", "gateway lost response"))
      .mockRejectedValueOnce(new TypeError("still offline"));
    await renderAccess();

    const formerRow = [...container.querySelectorAll("article")]
      .find((row) => row.textContent?.includes("Former Organizer"));
    await act(async () => formerRow?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .findLast((button) => button.textContent?.includes("Remove event access"))?.click());
    await settle();
    await act(async () => buttonNamed("Retry exact removal")?.click());
    await settle();
    await act(async () => buttonNamed("Check event access")?.click());
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(4);
    expect(apiMock.mock.calls[2]).toEqual(apiMock.mock.calls[1]);
    expect(apiMock.mock.calls[3]?.[0]).toBe(`events/${eventId}/access`);
    expect(container.textContent).toContain("Event access change unconfirmed");
    expect(buttonNamed("Retry exact removal")).toBeDefined();
    expect(buttonNamed("Check event access")).toBeDefined();
    expect(buttonNamed("Grant access")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(
      "Event access still couldn’t be checked. Restore your connection or permissions and try again.",
      { kind: "error" },
    );
  });

  it("does not treat an early authoritative check of the old state as a causal grant receipt", async () => {
    apiMock
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(overview);
    await renderAccess();

    await act(async () => buttonNamed("Grant access")?.click());
    const dialog = container.querySelector("dialog");
    await act(async () => buttonNamed("Alex Speaker", dialog ?? container)?.click());
    await act(async () => buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.click());
    await settle();
    await act(async () => buttonNamed("Check event access")?.click());
    await settle();

    expect(container.textContent).toContain("Event access change unconfirmed");
    expect(buttonNamed("Retry exact grant")).toBeDefined();
    expect(buttonNamed("Grant access")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(
      "Event access checked: alex@example.com currently has no access to this event. The earlier change may still be finishing; retry the exact action before leaving.",
      { kind: "error" },
    );
  });

  it("keeps the grant editable after a definitive rejection", async () => {
    apiMock
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new AppError("VALIDATION", "That role cannot be granted"));
    await renderAccess();

    await act(async () => buttonNamed("Grant access")?.click());
    const dialog = container.querySelector("dialog");
    await act(async () => buttonNamed("Alex Speaker", dialog ?? container)?.click());
    await act(async () => buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.click());
    await settle();

    expect(container.textContent).not.toContain("Event access change unconfirmed");
    expect(dialog?.textContent).toContain("That role cannot be granted");
    expect(buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.disabled).toBe(false);
    expect(dialog?.querySelector("select")?.disabled).toBe(false);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes stale grant authority after a definitive forbidden response", async () => {
    const restrictedOverview: EventAccessOverviewDTO = {
      ...overview,
      candidates: [],
      canGrant: false,
      grantRestriction: "Granting now requires an organization organizer.",
    };
    apiMock
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new AppError("FORBIDDEN", "Only organization organizers can grant access"))
      .mockResolvedValueOnce(restrictedOverview);
    await renderAccess();

    await act(async () => buttonNamed("Grant access")?.click());
    const dialog = container.querySelector("dialog");
    await act(async () => buttonNamed("Alex Speaker", dialog ?? container)?.click());
    await act(async () => buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.click());
    await settle();

    expect(apiMock.mock.calls[2]?.[0]).toBe(`events/${eventId}/access`);
    expect(container.querySelector("dialog")).toBeNull();
    expect(buttonNamed("Grant access")).toBeUndefined();
    expect(container.textContent).toContain("Granting now requires an organization organizer.");
    expect(container.textContent).not.toContain("Event access change unconfirmed");
    expect(toastMock).toHaveBeenLastCalledWith(
      "Granting now requires an organization organizer.",
      { kind: "error" },
    );
  });

  it("finishes recovery from current state after an exact grant replay is definitively rejected", async () => {
    const candidateGone: EventAccessOverviewDTO = {
      ...overview,
      candidates: overview.candidates.filter((candidate) => candidate.userId !== candidateId),
    };
    apiMock
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new AppError("FORBIDDEN", "That teammate left the organization"))
      .mockResolvedValueOnce(candidateGone);
    await renderAccess();

    await act(async () => buttonNamed("Grant access")?.click());
    const dialog = container.querySelector("dialog");
    await act(async () => buttonNamed("Alex Speaker", dialog ?? container)?.click());
    await act(async () => buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.click());
    await settle();
    await act(async () => buttonNamed("Retry exact grant")?.click());
    await settle();

    expect(container.textContent).toContain("Event access change unconfirmed");
    expect(toastMock).toHaveBeenLastCalledWith(
      "That teammate left the organization. Check current event access to finish recovery without repeating a rejected action.",
      { kind: "error" },
    );

    await act(async () => buttonNamed("Check event access")?.click());
    await settle();

    expect(container.textContent).not.toContain("Event access change unconfirmed");
    expect(buttonNamed("Grant access")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenLastCalledWith(
      "Event access checked: alex@example.com currently has no access to this event.",
    );
  });

  it("adopts owner access after an exact removal replay is definitively rejected", async () => {
    const ownerNow: EventAccessOverviewDTO = {
      ...removalOverview,
      members: removalOverview.members.map((member) => member.userId === formerMemberId
        ? { ...member, role: "owner", canRemove: false }
        : member),
    };
    apiMock
      .mockResolvedValueOnce(removalOverview)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new AppError("VALIDATION", "Event owner access cannot be removed here"))
      .mockResolvedValueOnce(ownerNow);
    await renderAccess();

    const formerRow = [...container.querySelectorAll("article")]
      .find((row) => row.textContent?.includes("Former Organizer"));
    await act(async () => formerRow?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .findLast((button) => button.textContent?.includes("Remove event access"))?.click());
    await settle();
    await act(async () => buttonNamed("Retry exact removal")?.click());
    await settle();
    await act(async () => buttonNamed("Check event access")?.click());
    await settle();

    expect(container.textContent).not.toContain("Event access change unconfirmed");
    expect(container.textContent).toContain("Transfer ownership before removing");
    expect(buttonNamed("Grant access")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenLastCalledWith(
      "Event access checked: former@example.com currently has owner access to this event.",
    );
  });

  it("refreshes stale removal controls after a definitive rejection", async () => {
    const ownerNow: EventAccessOverviewDTO = {
      ...removalOverview,
      members: removalOverview.members.map((member) => member.userId === formerMemberId
        ? { ...member, role: "owner", canRemove: false }
        : member),
    };
    apiMock
      .mockResolvedValueOnce(removalOverview)
      .mockRejectedValueOnce(new AppError("VALIDATION", "Event owner access cannot be removed here"))
      .mockResolvedValueOnce(ownerNow);
    await renderAccess();

    const formerRow = [...container.querySelectorAll("article")]
      .find((row) => row.textContent?.includes("Former Organizer"));
    await act(async () => formerRow?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .findLast((button) => button.textContent?.includes("Remove event access"))?.click());
    await settle();

    expect(apiMock.mock.calls[2]?.[0]).toBe(`events/${eventId}/access`);
    expect(container.textContent).toContain("Transfer ownership before removing");
    expect(buttonNamed("Remove event access")).toBeUndefined();
    expect(buttonNamed("Grant access")?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Event access change unconfirmed");
    expect(toastMock).toHaveBeenLastCalledWith(
      "Event owner access cannot be removed here",
      { kind: "error" },
    );
  });

  it("releases navigation into a truthful unavailable state after a definitive overview denial", async () => {
    apiMock
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new AppError("FORBIDDEN", "You no longer organize this event"));
    await renderAccess();

    await act(async () => buttonNamed("Grant access")?.click());
    const dialog = container.querySelector("dialog");
    await act(async () => buttonNamed("Alex Speaker", dialog ?? container)?.click());
    await act(async () => buttonNamed("Grant access", dialog?.querySelector("footer") ?? dialog ?? container)?.click());
    await settle();
    await act(async () => buttonNamed("Check event access")?.click());
    await settle();

    expect(container.textContent).not.toContain("Event access change unconfirmed");
    expect(container.textContent).toContain("You no longer organize this event. The access change can’t be confirmed from this account.");
    expect(buttonNamed("Grant access")).toBeUndefined();
    expect(container.querySelector(".event-access-roster")).toBeNull();
    expect(buttonNamed("Retry")).toBeDefined();

    await act(async () => buttonNamed("Switch settings tab")?.click());
    await settle();
    expect(routerPushMock).toHaveBeenCalledWith("/events");
    expect(buttonNamed("Working…")).toBeUndefined();
    expect(buttonNamed("Discard changes")).toBeUndefined();
  });
});
