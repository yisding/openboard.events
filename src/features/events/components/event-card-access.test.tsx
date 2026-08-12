import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { eventDtoSchema } from "@/shared/contracts";
import { eventManagementHref } from "@/features/events/access";
import { EventCard } from "./event-card";
import { EventsView } from "./events-view";

vi.mock("@/features/auth/components/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

Object.assign(globalThis, { React });

const event = eventDtoSchema.parse({
  id: "c4300000-0000-4000-8000-000000000001",
  name: "Truthful Access Conf",
  slug: "truthful-access-conf",
  eventType: "conference",
  websiteUrl: null,
  location: "Oakland",
  physicalAddress: null,
  timezone: "America/Los_Angeles",
  startsAt: "2026-09-15T16:00:00.000Z",
  endsAt: "2026-09-17T01:00:00.000Z",
  theme: null,
  logoFileId: null,
  backgroundFileId: null,
  submissionCapPerUser: 3,
  rowVersion: 1,
});

describe("event access destinations", () => {
  it("lands reviewers on the review queue and organizers on the dashboard", () => {
    expect(eventManagementHref(event.id, "reviewer")).toBe(`/events/${event.id}/review`);
    expect(eventManagementHref(event.id, "organizer")).toBe(`/events/${event.id}/dashboard`);
    expect(eventManagementHref(event.id, "owner")).toBe(`/events/${event.id}/dashboard`);
  });

  it("renders an explicit event member as one actionable card", () => {
    const html = renderToStaticMarkup(<EventCard event={event} eventRole="reviewer" />);
    expect(html).toContain(`href="/events/${event.id}/review"`);
    expect(html).toContain("Open review queue");
    expect(html).not.toContain("Ask an event owner for access");
  });

  it("renders an organization-only member as a locked card with no event link", () => {
    const html = renderToStaticMarkup(<EventCard event={event} eventRole={null} />);
    expect(html).toContain("event-card-locked");
    expect(html).toContain('class="event-access-locked"');
    expect(html).toContain("Ask an event owner for access");
    expect(html).not.toContain(`/events/${event.id}/`);
    expect(html).not.toContain("Open event");
  });

  it("shows reviewer-only users a directory path without a create action", () => {
    const html = renderToStaticMarkup(<EventsView
      events={[]}
      user={{ name: "Rae Reviewer", email: "reviewer@example.test" }}
      createHref={null}
      hasOrganizations
    />);
    expect(html).toContain("No events assigned");
    expect(html).toContain("workspace access, but no events are assigned");
    expect(html).toContain('href="/organizations"');
    expect(html).toContain("View organization directory");
    expect(html).not.toContain("Create event");
  });

  it("does not offer a looping directory action before organization access exists", () => {
    const html = renderToStaticMarkup(<EventsView
      events={[]}
      user={{ name: "New Admin", email: "new@example.test" }}
      createHref={null}
      hasOrganizations={false}
    />);
    expect(html).toContain("Ask an administrator to add you to an organization");
    expect(html).not.toContain('href="/organizations"');
    expect(html).not.toContain("Create event");
  });

  it("keeps creation available to organization managers", () => {
    const html = renderToStaticMarkup(<EventsView
      events={[]}
      user={{ name: "Ona Organizer", email: "organizer@example.test" }}
      createHref="/events/new"
      hasOrganizations
    />);
    expect(html).toContain("Create your first event");
    expect(html.match(/href="\/events\/new"/g)).toHaveLength(2);
  });
});
