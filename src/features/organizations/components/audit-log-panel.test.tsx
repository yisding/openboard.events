import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ORGANIZATION_AUDIT_ACTIONS, organizationAuditLogEntryDtoSchema, type OrganizationAuditLogEntryDTO } from "@/shared/contracts";
import { AuditLogPanel } from "./audit-log-panel";

Object.assign(globalThis, { React });

const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "40000000-0000-4000-8000-000000000001";

/** Overrides are untyped on purpose: the schema below is what validates them,
 *  so a test can write a plain id string without minting a branded type. */
function entry(overrides: Record<string, unknown> = {}): OrganizationAuditLogEntryDTO {
  return organizationAuditLogEntryDtoSchema.parse({
    id: "50000000-0000-4000-8000-000000000001",
    organizationId: ORGANIZATION_ID,
    actorUserId: ACTOR_ID,
    actorEmail: "owner@test.dev",
    action: "demo.provisioned",
    targetUserId: null,
    targetEmail: null,
    targetEventId: EVENT_ID,
    targetEventName: "First Fair",
    metadata: { eventId: EVENT_ID },
    createdAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  });
}

const render = (entries: OrganizationAuditLogEntryDTO[]) =>
  renderToStaticMarkup(<AuditLogPanel initialEntries={entries} />);

// The rows the reader sees, without the action filter's <option> values. Those
// options carry the raw action string as their machine value on purpose (it is
// the filter key); "renders as its raw identifier" is only ever about the
// visible cell, so the assertions below read the table body, not the toolbar.
const rowsOf = (html: string) => html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));

describe("AuditLogPanel", () => {
  it("names the demo lifecycle actions instead of printing their enum values", () => {
    const rows = rowsOf(render([
      entry({ action: "demo.provisioned" }),
      entry({ id: "50000000-0000-4000-8000-000000000002", action: "demo.reset" }),
      entry({ id: "50000000-0000-4000-8000-000000000003", action: "demo.deleted" }),
    ]));

    expect(rows).toContain("Built the sample event");
    expect(rows).toContain("Reset the sample event");
    expect(rows).toContain("Deleted the sample event");
    expect(rows).not.toContain("demo.provisioned");
    expect(rows).not.toContain("demo.reset");
    expect(rows).not.toContain("demo.deleted");
  });

  it("links the affected event by name", () => {
    const html = render([entry()]);

    expect(html).toContain(`href="/events/${EVENT_ID}"`);
    expect(html).toContain("First Fair");
    expect(html).not.toContain("—");
  });

  // `demo.deleted` is *about* an event that no longer exists, so there is no
  // name to print. The id is the only handle left, and dropping it back to "—"
  // would erase the single fact the entry exists to record.
  it("falls back to the event id once the event is gone", () => {
    const html = render([entry({ action: "demo.deleted", targetEventName: null })]);

    expect(html).toContain(EVENT_ID);
  });

  // Closes the class, not the instance: the bug was one action added by a
  // writer outside this feature with no label here, and `demo.provisioned` was
  // only the first that could happen to. `satisfies` already fails the build
  // for a missing key; this catches the other half — a key present but filled
  // in with the dotted identifier itself.
  it("has a human label for every action a writer may record", () => {
    const rows = rowsOf(render(ORGANIZATION_AUDIT_ACTIONS.map((action, index) => entry({
      id: `50000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
      action,
    }))));

    for (const action of ORGANIZATION_AUDIT_ACTIONS) {
      expect(rows, `${action} rendered as its raw identifier`).not.toContain(action);
    }
  });

  it("still names the person on a membership entry", () => {
    const html = render([entry({
      action: "member.removed",
      targetUserId: ACTOR_ID,
      targetEmail: "teammate@test.dev",
      targetEventId: null,
      targetEventName: null,
      metadata: { role: "organizer" },
    })]);

    expect(html).toContain("Removed a member");
    expect(html).toContain("teammate@test.dev");
  });

  // An invite and a revoke target somebody with no `users` row yet, so the
  // `target_user_id` join is null and `targetEmail` comes back null. The address
  // the writer captured is in the metadata, and that is what the cell now shows
  // rather than the "—" that erased who the entry is about.
  it("names the invitee from metadata when there is no account to join", () => {
    const html = render([
      entry({
        action: "member.invited",
        targetUserId: null,
        targetEmail: null,
        targetEventId: null,
        targetEventName: null,
        metadata: { email: "invitee@test.dev", role: "organizer" },
      }),
      entry({
        id: "50000000-0000-4000-8000-000000000009",
        action: "invitation.revoked",
        targetUserId: null,
        targetEmail: null,
        targetEventId: null,
        targetEventName: null,
        metadata: { email: "revoked@test.dev" },
      }),
    ]);

    expect(html).toContain("Invited a teammate");
    expect(html).toContain("invitee@test.dev");
    expect(html).toContain("Revoked an invitation");
    expect(html).toContain("revoked@test.dev");
    expect(html).not.toContain("—");
  });

  // A row that names nobody in either place — a corrupt or partial metadata —
  // still falls through to the em dash rather than rendering an empty string or
  // throwing on the untyped jsonb.
  it("shows the dash when neither the join nor the metadata names anyone", () => {
    const html = render([entry({
      action: "member.invited",
      targetUserId: null,
      targetEmail: null,
      targetEventId: null,
      targetEventName: null,
      metadata: { role: "organizer" },
    })]);

    expect(html).toContain("—");
  });
});
