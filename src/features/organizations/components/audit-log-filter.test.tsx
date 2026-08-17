/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizationAuditLogEntryDtoSchema, type OrganizationAuditLogEntryDTO } from "@/shared/contracts";
import { AuditLogPanel } from "./audit-log-panel";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";

let seq = 0;
function entry(overrides: Record<string, unknown> = {}): OrganizationAuditLogEntryDTO {
  seq += 1;
  return organizationAuditLogEntryDtoSchema.parse({
    id: `50000000-0000-4000-8000-0000000001${String(seq).padStart(2, "0")}`,
    organizationId: ORGANIZATION_ID,
    actorUserId: OWNER_ID,
    actorEmail: "owner@test.dev",
    action: "member.invited",
    targetUserId: null,
    targetEmail: null,
    targetEventId: null,
    targetEventName: null,
    metadata: { email: "invitee@test.dev" },
    createdAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  });
}

const ENTRIES = [
  entry({ actorEmail: "owner@test.dev", action: "member.invited", metadata: { email: "newbie@test.dev" } }),
  entry({ actorEmail: "organizer@test.dev", action: "member.role_changed", targetEmail: "member@test.dev", metadata: {} }),
  entry({ actorEmail: "owner@test.dev", action: "invitation.revoked", metadata: { email: "gone@test.dev" } }),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function bodyText(): string {
  return container.querySelector("tbody")?.textContent ?? container.textContent ?? "";
}

async function render(entries: OrganizationAuditLogEntryDTO[]) {
  await act(async () => root.render(<AuditLogPanel initialEntries={entries} />));
}

describe("AuditLogPanel filters", () => {
  it("narrows the rows to a typed actor", async () => {
    await render(ENTRIES);
    expect(bodyText()).toContain("organizer@test.dev");

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Filter by actor"]');
    expect(search).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "organizer");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const text = bodyText();
    expect(text).toContain("organizer@test.dev");
    expect(text).not.toContain("owner@test.dev");
  });

  it("narrows the rows to a chosen action, offering only actions present", async () => {
    await render(ENTRIES);
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by action"]');
    expect(select).not.toBeNull();

    // Only the three actions the log holds are options, plus the "all" default —
    // never the whole vocabulary of actions a writer could record.
    const optionValues = [...(select?.options ?? [])].map((option) => option.value);
    expect(optionValues).toEqual(
      expect.arrayContaining(["all", "member.invited", "member.role_changed", "invitation.revoked"]),
    );
    expect(optionValues).not.toContain("demo.provisioned");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "invitation.revoked");
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const text = bodyText();
    expect(text).toContain("Revoked an invitation");
    expect(text).not.toContain("Changed a member’s role");
    expect(text).not.toContain("Invited a teammate");
  });

  it("finds a deleted-account row by the label it shows", async () => {
    // The actor cell renders a null email as "(deleted account)". The filter
    // shares that label, so typing what is on screen narrows to it.
    await render([
      entry({ actorEmail: null, action: "member.removed", targetEmail: "member@test.dev", metadata: {} }),
      entry({ actorEmail: "owner@test.dev", action: "member.invited", metadata: { email: "newbie@test.dev" } }),
    ]);
    expect(bodyText()).toContain("(deleted account)");
    expect(bodyText()).toContain("owner@test.dev");

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Filter by actor"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "deleted");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const text = bodyText();
    expect(text).toContain("(deleted account)");
    expect(text).not.toContain("owner@test.dev");
  });

  it("explains an empty result as a filter, not an empty log", async () => {
    await render(ENTRIES);
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Filter by actor"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "nobody@nowhere.test");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("Nothing matches those filters");
  });
});
