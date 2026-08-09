import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAppError } from "@/shared/lib/errors";
import {
  buildFeed,
  buildInvite,
  googleCalendarUrl,
  icsUid,
  outlookCalendarUrl,
  type IcsEvent,
} from "./ics";

const CRLF = "\r\n";
const fixtureRecipient = "nadia@example.com";

const requestEvent: IcsEvent = {
  uid: "sess-session-1-spk-contact-1@events.example.com",
  sequence: 0,
  method: "REQUEST",
  startsAt: new Date("2026-09-15T16:00:00.000Z"),
  endsAt: new Date("2026-09-15T16:30:00.000Z"),
  dtstamp: new Date("2026-08-09T12:34:56.000Z"),
  summary: "Agents; evals, production",
  description: "Line one\nLine two; important, really",
  location: "Main Stage, Fort Mason",
  url: "https://events.example.com/e/ai-engineer/schedule?session=session-1",
  organizer: { name: "AI Engineer; Events", email: "speakers@events.example.com" },
  attendee: { name: "Nadia, Speaker", email: fixtureRecipient },
};

function omitAttendee(event: IcsEvent): Omit<IcsEvent, "attendee"> {
  const { attendee, ...attendeeLess } = event;
  void attendee;
  return attendeeLess;
}

const attendeeLessEvent = omitAttendee(requestEvent);

function fixture(name: string): string {
  const value = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
  return value.replace(/\r?\n/g, CRLF);
}

function unfoldedLines(value: string): string[] {
  return value.replaceAll(`${CRLF} `, "").split(CRLF).filter(Boolean);
}

function expectRfcLines(value: string): void {
  expect(value.endsWith(CRLF)).toBe(true);
  expect(value).not.toMatch(/(^|[^\r])\n/);
  expect(value).not.toMatch(/\r(?!\n)/);
  for (const line of value.slice(0, -CRLF.length).split(CRLF)) {
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  }
}

describe("ICS builder", () => {
  it("matches the REQUEST golden fixture exactly", () => {
    const result = buildInvite(requestEvent);
    expect(result).toBe(fixture("request.ics"));
    expect(unfoldedLines(result)).toContain(`ATTENDEE;CN="Nadia, Speaker";PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${fixtureRecipient}`);
    expectRfcLines(result);
  });

  it("bumps SEQUENCE without changing UID or ORGANIZER", () => {
    const first = unfoldedLines(buildInvite(requestEvent));
    const changed = unfoldedLines(buildInvite({ ...requestEvent, sequence: 1 }));
    expect(first.find((line) => line.startsWith("UID:"))).toBe(changed.find((line) => line.startsWith("UID:")));
    expect(first.find((line) => line.startsWith("ORGANIZER;"))).toBe(changed.find((line) => line.startsWith("ORGANIZER;")));
    expect(changed).toContain("SEQUENCE:1");
  });

  it("matches the CANCEL fixture with a stable identity and higher sequence", () => {
    const result = buildInvite({ ...requestEvent, sequence: 2, method: "CANCEL", cancelled: true });
    expect(result).toBe(fixture("cancel.ics"));
    const requestOrganizer = unfoldedLines(buildInvite(requestEvent)).find((line) => line.startsWith("ORGANIZER;"));
    const cancelLines = unfoldedLines(result);
    expect(cancelLines).toContain("METHOD:CANCEL");
    expect(cancelLines).toContain("STATUS:CANCELLED");
    expect(cancelLines).toContain("SEQUENCE:2");
    expect(cancelLines.find((line) => line.startsWith("ORGANIZER;"))).toBe(requestOrganizer);
  });

  it("matches a METHOD-less two-event feed fixture", () => {
    const feedEvents: IcsEvent[] = [
      { ...attendeeLessEvent, method: null },
      {
        ...attendeeLessEvent,
        uid: "sess-session-2-spk-contact-1@events.example.com",
        method: null,
        startsAt: new Date("2026-09-15T17:00:00.000Z"),
        endsAt: new Date("2026-09-15T17:45:00.000Z"),
        summary: "Unicode calendars 🧠",
      },
    ];
    const result = buildFeed("Nadia's AI Engineer sessions", feedEvents);
    expect(result).toBe(fixture("feed.ics"));
    expect(result).not.toMatch(/^METHOD:/m);
    expect(result.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(unfoldedLines(result).filter((line) => line.startsWith("UID:"))).toEqual(feedEvents.map((event) => `UID:${event.uid}`));
    expectRfcLines(result);
  });

  it("uses METHOD:PUBLISH for a single attendee-less download", () => {
    const result = buildInvite({ ...attendeeLessEvent, method: null });
    expect(unfoldedLines(result)).toContain("METHOD:PUBLISH");
  });

  it("escapes hostile text and folds multi-byte characters at 75 UTF-8 octets", () => {
    const summary = `🧠${"a".repeat(64)};lkj, "x"\n<img onerror=alert(1)>`;
    const result = buildInvite({ ...requestEvent, summary });
    expect(unfoldedLines(result)).toContain(`SUMMARY:🧠${"a".repeat(64)}\\;lkj\\, "x"\\n<img onerror=alert(1)>`);
    expectRfcLines(result);
  });

  it("quotes CN parameters and caret-encodes unsafe quoted-string characters", () => {
    const result = buildInvite({
      ...requestEvent,
      organizer: { ...requestEvent.organizer, name: 'AI: Engineer; "Events"' },
      attendee: { name: "Nadia^Speaker\nLead", email: fixtureRecipient },
    });
    const lines = unfoldedLines(result);
    expect(lines).toContain("ORGANIZER;CN=\"AI: Engineer; ^'Events^'\":mailto:speakers@events.example.com");
    expect(lines).toContain(`ATTENDEE;CN="Nadia^^Speaker^nLead";PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${fixtureRecipient}`);
  });

  it("rejects REQUEST and CANCEL invites without an attendee", () => {
    for (const method of ["REQUEST", "CANCEL"] as const) {
      try {
        buildInvite({ ...attendeeLessEvent, method });
        expect.fail("expected buildInvite to throw");
      } catch (error) {
        expect(isAppError(error)).toBe(true);
        if (isAppError(error)) expect(error.code).toBe("VALIDATION");
      }
    }
  });

  it("builds parseable Google and Outlook links with exact UTC times", () => {
    const complex = { ...requestEvent, summary: "Agents & evals, #1" };
    const google = new URL(googleCalendarUrl(complex));
    expect(google.origin).toBe("https://calendar.google.com");
    expect(google.searchParams.get("action")).toBe("TEMPLATE");
    expect(google.searchParams.get("text")).toBe(complex.summary);
    expect(google.searchParams.get("dates")).toBe("20260915T160000Z/20260915T163000Z");
    expect(google.searchParams.get("location")).toBe(complex.location);

    const outlook = new URL(outlookCalendarUrl(complex));
    expect(outlook.origin).toBe("https://outlook.live.com");
    expect(outlook.searchParams.get("subject")).toBe(complex.summary);
    expect(outlook.searchParams.get("startdt")).toBe(complex.startsAt.toISOString());
    expect(outlook.searchParams.get("enddt")).toBe(complex.endsAt.toISOString());
    expect(outlook.searchParams.get("location")).toBe(complex.location);
  });

  it("builds the plan-authoritative stable UID", () => {
    expect(icsUid("session-1", "contact-1", "events.example.com")).toBe(
      "sess-session-1-spk-contact-1@events.example.com",
    );
  });
});
