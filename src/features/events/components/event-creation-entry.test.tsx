import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EventsView } from "./events-view";

vi.mock("@/features/auth/index.client", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

Object.assign(globalThis, { React });

describe("event creation entry points", () => {
  it("offers guided creation to organization managers", () => {
    const html = renderToStaticMarkup(<EventsView
      events={[]}
      user={{ name: "Ada Organizer", email: "ada@example.test" }}
      createHref="/organizations/30000000-0000-4000-8000-000000000001/onboarding?mode=create"
      hasOrganizations
    />);

    expect(html.match(/Create event/g)).toHaveLength(2);
    expect(html).toContain('href="/organizations/30000000-0000-4000-8000-000000000001/onboarding?mode=create"');
    expect(html).not.toContain('href="/events/new"');
  });

  it("does not offer creation to reviewer-only users", () => {
    const html = renderToStaticMarkup(<EventsView
      events={[]}
      user={{ name: "Rae Reviewer", email: "rae@example.test" }}
      createHref={null}
      hasOrganizations
    />);

    expect(html).not.toContain("Create event");
    expect(html).toContain("No events assigned");
    expect(html).toContain("You have workspace access, but no events are assigned to you yet.");
    expect(html).toContain("View organization directory");
  });

  it("keeps the direct URL and API as compatibility doors into the canonical flow", () => {
    const newPage = readFileSync(new URL("../../../app/events/new/page.tsx", import.meta.url), "utf8");
    const eventsRoute = readFileSync(new URL("../../../app/api/internal/events/route.ts", import.meta.url), "utf8");
    const eventLayout = readFileSync(new URL("../../../app/events/[eventId]/layout.tsx", import.meta.url), "utf8");
    const eventSwitcher = readFileSync(new URL("./event-switcher.tsx", import.meta.url), "utf8");

    expect(newPage).toContain('.filter(({ role }) => roleSatisfies(role, "organizer"))');
    expect(newPage).toContain("memberships.length === 1 && only");
    expect(newPage).toContain("Choose the workspace that should own this event.");
    // First Fair (design §1.2): every entrance that already carries a create
    // intent says so, or the guided-setup page offers the demo fork to an
    // organizer who came here specifically to make a real event.
    expect(newPage).toContain("`/organizations/${only.organization.id}/onboarding?mode=create`");
    expect(newPage).not.toContain("<EventForm");
    expect(eventsRoute).toContain("provisionEventForActor(actorId, input)");
    expect(eventsRoute).not.toContain("createEvent(actorId");
    expect(eventLayout).toContain("manageableOrganizations(organizationMemberships).length > 0");
    expect(eventSwitcher).toContain('"/organizations?intent=create-event"');
    expect(eventSwitcher).toContain("demoEvents || !canCreateEvent");
  });
});
