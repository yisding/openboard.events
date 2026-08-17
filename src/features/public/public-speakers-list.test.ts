import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PUBLISHED_SPEAKERS_FIXTURE } from "@/shared/fixtures/sessions";
import { formatDateRangeInZone } from "@/shared/lib/time";
import { PublicSpeakersList } from "./public-speakers-list";

Object.assign(globalThis, { React });

const [firstSpeaker] = PUBLISHED_SPEAKERS_FIXTURE.speakers;
if (!firstSpeaker) throw new Error("fixture must carry at least one speaker");

describe("PublicSpeakersList", () => {
  it("renders the compact directory row for each confirmed speaker", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSpeakersList, {
      eventSlug: "openboard-summit",
      speakers: PUBLISHED_SPEAKERS_FIXTURE,
    }));

    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Principal Engineer");
    expect(html).toContain('aria-label="Search speakers, companies, or topics"');
    expect(html).toContain('placeholder="Search name, company, or topic"');
  });

  it("expands the deep-linked speaker's row into bio + session detail", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSpeakersList, {
      eventSlug: "openboard-summit",
      speakers: PUBLISHED_SPEAKERS_FIXTURE,
      initialSpeakerId: firstSpeaker.contactId,
    }));

    expect(html).toContain("Computing pioneer");
    expect(html).toContain("Main Hall");
  });

  it("hides bio when the embed field-visibility filter turns it off", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSpeakersList, {
      eventSlug: "openboard-summit",
      speakers: PUBLISHED_SPEAKERS_FIXTURE,
      initialSpeakerId: firstSpeaker.contactId,
      filters: { fields: { speakerBio: false } },
    }));

    expect(html).not.toContain("Computing pioneer");
  });

  it("only offers the agenda from its empty state when the agenda has sessions", () => {
    const empty = { ...PUBLISHED_SPEAKERS_FIXTURE, speakers: [] };
    const alone = renderToStaticMarkup(React.createElement(PublicSpeakersList, { eventSlug: "openboard-summit", speakers: empty }));
    const withAgenda = renderToStaticMarkup(React.createElement(PublicSpeakersList, { eventSlug: "openboard-summit", speakers: empty, hasSessions: true }));

    expect(alone).toContain("Speakers coming soon");
    expect(alone).not.toContain("View the agenda");
    expect(withAgenda).toContain("View the agenda");
  });

  // Issue #667: the speakers DTO used to omit event.startsAt/endsAt, so the
  // hero band's date eyebrow had nothing to render here — unlike every other
  // public surface — and sat empty.
  it("renders the event date eyebrow in the hero, same as the other public surfaces", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSpeakersList, {
      eventSlug: "openboard-summit",
      speakers: PUBLISHED_SPEAKERS_FIXTURE,
    }));
    const range = formatDateRangeInZone(
      PUBLISHED_SPEAKERS_FIXTURE.event.startsAt,
      PUBLISHED_SPEAKERS_FIXTURE.event.endsAt,
      PUBLISHED_SPEAKERS_FIXTURE.event.timezone,
      { showZone: false },
    ).toUpperCase();

    expect(html).toContain('class="public-eyebrow"');
    expect(html).toContain(range);
  });
});
