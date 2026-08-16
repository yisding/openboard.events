import { describe, expect, it } from "vitest";
import { createEventInputSchema, eventDetailsPatchSchema } from "./schemas";

const validBody = {
  name: "AI Engineer World's Fair",
  eventType: "conference" as const,
  timezone: "America/Los_Angeles",
  startsAt: "2026-10-19T16:00:00.000Z",
  endsAt: "2026-10-21T01:00:00.000Z",
};

/**
 * First Fair's billing/mail-safety hinge, asserted at the only place a
 * request body becomes a `CreateEventInput`.
 *
 * `events.is_demo` exempts an event from the plan-slot count and makes the
 * comms dispatcher refuse to deliver anything for it. Both are load-bearing,
 * so the flag is a server-only options argument to `createEventIn` and is
 * deliberately absent from these two schemas: `POST /api/internal/events` and
 * the organization onboarding route parse the create schema straight from the
 * wire, and the Details tab parses the patch schema. A field on either would
 * let any organizer mint unlimited plan-exempt events, or flip a demo full of
 * eighteen fabricated speakers into one that can mail them.
 */
describe("event schemas keep `isDemo` off the wire", () => {
  it("has no isDemo key on either HTTP-facing schema", () => {
    expect(Object.keys(createEventInputSchema.shape)).not.toContain("isDemo");
    expect(Object.keys(eventDetailsPatchSchema.shape)).not.toContain("isDemo");
  });

  it("strips isDemo out of a create body that tries to supply it", () => {
    const parsed = createEventInputSchema.parse({ ...validBody, isDemo: true });
    expect(parsed).not.toHaveProperty("isDemo");
  });

  it("strips isDemo out of a details patch that tries to supply it", () => {
    const parsed = eventDetailsPatchSchema.parse({ name: "Renamed", isDemo: false });
    expect(parsed).not.toHaveProperty("isDemo");
  });
});
