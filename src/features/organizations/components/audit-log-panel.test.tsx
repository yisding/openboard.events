import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { organizationAuditLogEntryDtoSchema, type OrganizationAuditLogEntryDTO } from "@/shared/contracts";
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

describe("AuditLogPanel", () => {
  it("names the demo lifecycle actions instead of printing their enum values", () => {
    const html = render([
      entry({ action: "demo.provisioned" }),
      entry({ id: "50000000-0000-4000-8000-000000000002", action: "demo.reset" }),
      entry({ id: "50000000-0000-4000-8000-000000000003", action: "demo.deleted" }),
    ]);

    expect(html).toContain("Built the sample event");
    expect(html).toContain("Reset the sample event");
    expect(html).toContain("Deleted the sample event");
    expect(html).not.toContain("demo.provisioned");
    expect(html).not.toContain("demo.reset");
    expect(html).not.toContain("demo.deleted");
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
});
