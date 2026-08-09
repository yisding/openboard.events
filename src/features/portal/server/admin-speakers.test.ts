import { describe, expect, it } from "vitest";
import { contactSpeakerRecord } from "./admin-speakers";

describe("admin speaker deep-link records", () => {
  it("keeps the dashboard contact id and maps persisted profile fields", () => {
    expect(contactSpeakerRecord({
      id: "contact-1",
      eventId: "event-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      jobTitle: "Programmer",
      bioHtml: "<p>Writes <strong>programs</strong>.</p>",
      headshotFileId: null,
      linkedinUrl: null,
      websiteUrl: "https://example.com",
      confirmation: "confirmed",
    })).toMatchObject({
      id: "contact-1",
      eventId: "event-1",
      firstName: "Ada",
      lastName: "Lovelace",
      bio: "Writes programs.",
      avatar: "AL",
      hasHeadshot: false,
      confirmation: "confirmed",
    });
  });
});
