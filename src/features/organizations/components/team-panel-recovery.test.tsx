/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventAccessOverviewDtoSchema,
  eventIdSchema,
  manageableEventAccessDtoSchema,
  organizationIdSchema,
  organizationInvitationDtoSchema,
  organizationInvitationIdSchema,
  organizationMemberDtoSchema,
  userIdSchema,
  type OrganizationInvitationDTO,
  type OrganizationMemberDTO,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { TeamPanel } from "./team-panel";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("a6000000-0000-4000-8000-000000000001");
const ownerId = userIdSchema.parse("a6000000-0000-4000-8000-000000000002");
const reviewerId = userIdSchema.parse("a6000000-0000-4000-8000-000000000003");
const eventId = eventIdSchema.parse("a6000000-0000-4000-8000-000000000004");
const invitationId = organizationInvitationIdSchema.parse("a6000000-0000-4000-8000-000000000005");
const createdAt = "2026-08-13T18:00:00.000Z";
const owner = organizationMemberDtoSchema.parse({
  userId: ownerId,
  organizationId,
  email: "owner@example.com",
  name: "Ada Owner",
  role: "owner",
  eventAccessCount: 0,
  createdAt,
});
const reviewer = organizationMemberDtoSchema.parse({
  userId: reviewerId,
  organizationId,
  email: "reviewer@example.com",
  name: "Rae Reviewer",
  role: "reviewer",
  eventAccessCount: 0,
  createdAt,
});
const invitation = organizationInvitationDtoSchema.parse({
  id: invitationId,
  organizationId,
  email: "invitee@example.com",
  role: "organizer",
  invitedByUserId: ownerId,
  createdAt,
  expiresAt: "2026-08-20T18:00:00.000Z",
  acceptedAt: null,
  revokedAt: null,
});
const noEventAccess = manageableEventAccessDtoSchema.parse({ eventId, eventName: "Main Stage", role: null });
const reviewerEventAccess = manageableEventAccessDtoSchema.parse({ ...noEventAccess, role: "reviewer" });

function eventAccessOverview(role: "owner" | "organizer" | "reviewer" | null, organizationMember = true) {
  return eventAccessOverviewDtoSchema.parse({
    members: role ? [{
      userId: reviewerId,
      email: reviewer.email,
      name: reviewer.name,
      role,
      organizationMember,
      canRemove: role !== "owner",
    }] : [],
    candidates: [],
    canGrant: true,
    grantRestriction: null,
  });
}

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 6; step += 1) await Promise.resolve();
  });
}

async function renderTeam(
  initialMembers: OrganizationMemberDTO[] = [owner, reviewer],
  initialInvitations: OrganizationInvitationDTO[] = [],
): Promise<void> {
  await act(async () => {
    root.render(
      <TeamPanel
        organizationId={organizationId}
        currentUserId={ownerId}
        currentRole="owner"
        initialMembers={initialMembers}
        initialInvitations={initialInvitations}
      />,
    );
    await Promise.resolve();
  });
}

function buttonNamed(name: string, within: ParentNode = container): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function memberRow(email: string): HTMLTableRowElement {
  const row = [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .find((candidate) => candidate.textContent?.includes(email));
  if (!row) throw new Error(`expected member row for ${email}`);
  return row;
}

function invitationRow(email: string): HTMLTableRowElement {
  const row = [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .find((candidate) => candidate.textContent?.includes(email));
  if (!row) throw new Error(`expected invitation row for ${email}`);
  return row;
}

async function requestRemoval(email = reviewer.email): Promise<void> {
  await act(async () => buttonNamed("Remove", memberRow(email))?.click());
  const dialog = container.querySelector<HTMLDialogElement>("dialog");
  if (!dialog) throw new Error("expected removal confirmation");
  await act(async () => buttonNamed("Remove", dialog)?.click());
}

async function chooseRole(email: string, role: string): Promise<void> {
  const select = memberRow(email).querySelector<HTMLSelectElement>("select");
  if (!select) throw new Error(`expected role select for ${email}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, role);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("organization Team membership recovery", () => {
  it("treats an INTERNAL role response as ambiguous and adopts the committed authoritative role", async () => {
    const promotedReviewer = organizationMemberDtoSchema.parse({ ...reviewer, role: "organizer" });
    apiMock
      .mockRejectedValueOnce(new AppError("INTERNAL", "Unexpected API response (500)"))
      .mockResolvedValueOnce([owner, promotedReviewer]);
    await renderTeam();

    await chooseRole(reviewer.email, "organizer");
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenNthCalledWith(2,
      `organizations/${organizationId}/members`,
      expect.anything(),
    );
    expect(memberRow(reviewer.email).querySelector<HTMLSelectElement>("select")?.value).toBe("organizer");
    expect(container.textContent).not.toContain("Team access is unconfirmed");
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: ${reviewer.email} currently has the organizer organization role.`,
    );
    expect(toastMock).not.toHaveBeenCalledWith(`${reviewer.email} is now organizer`);
  });

  it("serializes writes and recovers a committed removal after its response is lost", async () => {
    let rejectRemoval!: (error: unknown) => void;
    apiMock
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRemoval = reject; }))
      .mockResolvedValueOnce([owner]);
    await renderTeam();

    await requestRemoval();
    expect(memberRow(owner.email).querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(buttonNamed("Invite teammate")?.disabled).toBe(true);

    rejectRemoval(new TypeError("response lost"));
    await settle();

    expect(container.textContent).not.toContain(reviewer.email);
    expect(apiMock).toHaveBeenNthCalledWith(1,
      `organizations/${organizationId}/members/${reviewerId}`,
      expect.anything(),
      { method: "DELETE" },
    );
    expect(apiMock).toHaveBeenNthCalledWith(2,
      `organizations/${organizationId}/members`,
      expect.anything(),
    );
    expect(container.textContent).not.toContain("Team access is unconfirmed");
    expect(buttonNamed("Invite teammate")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: ${reviewer.email} is not currently an organization member.`,
    );
  });

  it("keeps every Team mutation locked through repeated offline checks, then adopts the authoritative roster", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("still offline"))
      .mockResolvedValueOnce([owner, reviewer]);
    await renderTeam();

    await requestRemoval();
    await settle();

    expect(container.textContent).toContain("Team access is unconfirmed");
    expect(container.textContent).toContain("Restore your connection");
    expect(buttonNamed("Invite teammate")?.disabled).toBe(true);
    expect(memberRow(owner.email).querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(apiMock).toHaveBeenCalledTimes(2);

    await act(async () => buttonNamed("Check team")?.click());
    await settle();
    expect(container.textContent).toContain("Team access is unconfirmed");
    expect(buttonNamed("Invite teammate")?.disabled).toBe(true);
    expect(apiMock).toHaveBeenCalledTimes(3);
    expect(toastMock).toHaveBeenCalledWith(
      "The team still couldn’t be checked. Restore your connection and try again.",
      { kind: "error" },
    );

    await act(async () => buttonNamed("Check team")?.click());
    await settle();
    expect(container.textContent).not.toContain("Team access is unconfirmed");
    expect(memberRow(reviewer.email)).toBeDefined();
    expect(buttonNamed("Invite teammate")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: ${reviewer.email} currently has the reviewer organization role.`,
    );
  });

  it("reconciles ambiguous invitation sends and revokes from the authoritative Team reads", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("invite response lost"))
      .mockResolvedValueOnce([owner, reviewer])
      .mockResolvedValueOnce([invitation])
      .mockRejectedValueOnce(new AppError("INTERNAL", "revoke response lost"))
      .mockResolvedValueOnce([owner, reviewer])
      .mockResolvedValueOnce([]);
    await renderTeam();

    await act(async () => buttonNamed("Invite teammate")?.click());
    const inviteDialog = container.querySelector<HTMLDialogElement>("dialog");
    const emailInput = inviteDialog?.querySelector<HTMLInputElement>('input[type="email"]');
    if (!inviteDialog || !emailInput) throw new Error("expected invitation dialog");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(emailInput, invitation.email);
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonNamed("Send invitation", inviteDialog)?.click());
    await settle();

    expect(apiMock).toHaveBeenNthCalledWith(2, `organizations/${organizationId}/members`, expect.anything());
    expect(apiMock).toHaveBeenNthCalledWith(3, `organizations/${organizationId}/invitations`, expect.anything());
    expect(invitationRow(invitation.email)).toBeDefined();
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: ${invitation.email} currently has a pending organizer invitation.`,
    );

    await act(async () => buttonNamed("Revoke", invitationRow(invitation.email))?.click());
    const revokeDialog = [...container.querySelectorAll<HTMLDialogElement>("dialog")]
      .find((dialog) => dialog.open && dialog.textContent?.includes(invitation.email));
    if (!revokeDialog) throw new Error("expected revoke confirmation");
    await act(async () => buttonNamed("Revoke", revokeDialog)?.click());
    await settle();

    expect(apiMock).toHaveBeenNthCalledWith(5, `organizations/${organizationId}/members`, expect.anything());
    expect(apiMock).toHaveBeenNthCalledWith(6, `organizations/${organizationId}/invitations`, expect.anything());
    expect(container.textContent).not.toContain(invitation.email);
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: there is currently no pending invitation for ${invitation.email}.`,
    );
  });

  it("reconciles ambiguous event-access grants and removals before unlocking Team writes", async () => {
    const reviewerWithAccess = organizationMemberDtoSchema.parse({ ...reviewer, eventAccessCount: 1 });
    apiMock
      .mockResolvedValueOnce([noEventAccess])
      .mockRejectedValueOnce(new TypeError("grant response lost"))
      .mockResolvedValueOnce([owner, reviewerWithAccess])
      .mockResolvedValueOnce(eventAccessOverview("reviewer"))
      .mockRejectedValueOnce(new AppError("INTERNAL", "remove response lost"))
      .mockResolvedValueOnce([owner, reviewer])
      .mockResolvedValueOnce(eventAccessOverview(null));
    await renderTeam();

    await act(async () => buttonNamed("Event access", memberRow(reviewer.email))?.click());
    await settle();
    const accessDialog = [...container.querySelectorAll<HTMLDialogElement>("dialog")]
      .find((dialog) => dialog.open && dialog.textContent?.includes("Event access for"));
    if (!accessDialog) throw new Error("expected event access dialog");
    await act(async () => buttonNamed("Grant access", accessDialog)?.click());
    await settle();

    expect(apiMock).toHaveBeenNthCalledWith(3, `organizations/${organizationId}/members`, expect.anything());
    expect(apiMock).toHaveBeenNthCalledWith(
      4,
      `events/${eventId}/access`,
      expect.anything(),
    );
    expect(accessDialog.textContent).toContain("Current access: reviewer");
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: ${reviewer.email} currently has reviewer access to ${noEventAccess.eventName}.`,
    );

    await act(async () => buttonNamed("Remove access", accessDialog)?.click());
    const removeDialog = [...container.querySelectorAll<HTMLDialogElement>("dialog")]
      .find((dialog) => dialog.open && dialog.textContent?.includes(`Remove access to ${noEventAccess.eventName}`));
    if (!removeDialog) throw new Error("expected event access removal confirmation");
    await act(async () => buttonNamed("Remove event access", removeDialog)?.click());
    await settle();

    expect(apiMock).toHaveBeenNthCalledWith(6, `organizations/${organizationId}/members`, expect.anything());
    expect(apiMock).toHaveBeenNthCalledWith(
      7,
      `events/${eventId}/access`,
      expect.anything(),
    );
    const reconciledAccessDialog = [...container.querySelectorAll<HTMLDialogElement>("dialog")]
      .find((dialog) => dialog.open && dialog.textContent?.includes("Event access for"));
    expect(reconciledAccessDialog?.textContent).toContain("No event access");
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: ${reviewer.email} currently has no access to ${noEventAccess.eventName}.`,
    );
    expect(buttonNamed("Invite teammate")?.disabled).toBe(false);
  });

  it("observes surviving event access when the target is concurrently removed from the organization", async () => {
    apiMock
      .mockResolvedValueOnce([reviewerEventAccess])
      .mockRejectedValueOnce(new TypeError("update response lost"))
      .mockResolvedValueOnce([owner])
      .mockResolvedValueOnce(eventAccessOverview("organizer", false));
    await renderTeam();

    await act(async () => buttonNamed("Event access", memberRow(reviewer.email))?.click());
    await settle();
    const accessDialog = [...container.querySelectorAll<HTMLDialogElement>("dialog")]
      .find((dialog) => dialog.open && dialog.textContent?.includes("Event access for"));
    const roleSelect = accessDialog?.querySelector<HTMLSelectElement>(`select[aria-label="Role for ${noEventAccess.eventName}"]`);
    if (!accessDialog || !roleSelect) throw new Error("expected event access controls");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(roleSelect, "organizer");
      roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => buttonNamed("Update", accessDialog)?.click());
    await settle();

    expect(apiMock).toHaveBeenNthCalledWith(3, `organizations/${organizationId}/members`, expect.anything());
    expect(apiMock).toHaveBeenNthCalledWith(4, `events/${eventId}/access`, expect.anything());
    expect(accessDialog.textContent).toContain("Current access: organizer");
    expect(container.textContent).not.toContain("Team access is unconfirmed");
    expect(() => memberRow(reviewer.email)).toThrow();
    expect(toastMock).toHaveBeenCalledWith(
      `Team checked: ${reviewer.email} currently has organizer access to ${noEventAccess.eventName}.`,
    );
    expect(toastMock).not.toHaveBeenCalledWith(expect.stringContaining("no access"));
  });

  it("recognizes a lost-response self-demotion through the reviewer-readable organization list", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("role response lost"))
      .mockRejectedValueOnce(new AppError("FORBIDDEN", "Organizer access required"))
      .mockResolvedValueOnce([{
        id: organizationId,
        name: "Openboard",
        slug: "openboard",
        createdAt,
        role: "reviewer",
      }]);
    await renderTeam();

    await chooseRole(owner.email, "reviewer");
    await settle();

    expect(apiMock).toHaveBeenNthCalledWith(3, "organizations", expect.anything());
    expect(container.textContent).not.toContain("Team access is unconfirmed");
    expect(container.textContent).toContain("Your Team access changed");
    expect(container.textContent).toContain("Your organization role is now reviewer");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/organizations"]')?.textContent).toBe("View organizations");
    expect(buttonNamed("Invite teammate")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenCalledWith(
      "Your organization role is currently reviewer. Return to your organizations to continue with your current access.",
    );
  });

  it("keeps definitive guidance editable without an unnecessary authority fetch", async () => {
    apiMock
      .mockRejectedValueOnce(new AppError("FORBIDDEN", "Only an owner can grant or revoke ownership"))
      .mockResolvedValueOnce({ userId: reviewerId, role: "organizer" });
    await renderTeam();

    await chooseRole(reviewer.email, "organizer");
    await settle();

    const restored = memberRow(reviewer.email).querySelector<HTMLSelectElement>("select");
    expect(restored?.value).toBe("reviewer");
    expect(restored?.disabled).toBe(false);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("Only an owner can grant or revoke ownership", { kind: "error" });

    await chooseRole(reviewer.email, "organizer");
    await settle();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(memberRow(reviewer.email).querySelector<HTMLSelectElement>("select")?.value).toBe("organizer");
  });
});
