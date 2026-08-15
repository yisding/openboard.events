import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PUBLISHED_SPEAKERS_FIXTURE } from "@/shared/fixtures/sessions";
import { PublicSpeakerGallery } from "./public-speaker-gallery";

Object.assign(globalThis, { React });

const [firstSpeaker] = PUBLISHED_SPEAKERS_FIXTURE.speakers;
if (!firstSpeaker) throw new Error("fixture must carry at least one speaker");

describe("PublicSpeakerGallery", () => {
  it("renders a surname-sorted (server-order) photo grid of confirmed speakers", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, {
      eventSlug: "openboard-summit",
      speakers: PUBLISHED_SPEAKERS_FIXTURE,
    }));

    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Analytical Engines");
    expect(html).toContain('aria-label="View profile for Ada Lovelace"');
    expect(html).toContain('aria-label="Search speakers, companies, or topics"');
    expect(html).toContain('placeholder="Search name, company, or topic"');
    expect(html).not.toContain('role="button"');
  });

  it("renders the decoded biography preview rather than encoded markup", () => {
    const speakers = {
      ...PUBLISHED_SPEAKERS_FIXTURE,
      speakers: [{ ...firstSpeaker, bioHtml: '<p><span title="5 > 3">R&amp;D&nbsp;agents</span></p>' }],
    };
    const html = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, {
      eventSlug: "openboard-summit",
      speakers,
    }));

    expect(html).toContain("R&amp;D agents");
    expect(html).not.toContain("R&amp;amp;D");
  });

  it("omits missing public profile fields instead of rendering dash placeholders", () => {
    const speaker = {
      ...firstSpeaker,
      jobTitle: null,
      company: null,
      bioHtml: null,
      linkedinUrl: null,
      twitterUrl: null,
      websiteUrl: null,
      sessions: [],
    };
    const speakers = { ...PUBLISHED_SPEAKERS_FIXTURE, speakers: [speaker] };
    const card = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, {
      eventSlug: "openboard-summit",
      speakers,
    }));
    const detail = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, {
      eventSlug: "openboard-summit",
      speakers,
      initialSpeakerId: speaker.contactId,
    }));

    expect(card).not.toContain("<small>");
    expect(card).not.toContain('class="dash"');
    expect(detail).not.toContain("No bio yet");
    expect(detail).not.toContain("Their sessions");
    expect(detail).not.toContain('class="dash"');
  });

  it("hides company on the card when the embed field-visibility filter turns it off", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, {
      eventSlug: "openboard-summit",
      speakers: PUBLISHED_SPEAKERS_FIXTURE,
      filters: { fields: { speakerCompany: false } },
    }));

    expect(html).toContain("Ada Lovelace");
    expect(html).not.toContain("Analytical Engines");
  });

  it("shows the coming-soon empty state with no confirmed speakers, and no link to an empty agenda", () => {
    const empty = { ...PUBLISHED_SPEAKERS_FIXTURE, speakers: [] };
    const html = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, { eventSlug: "openboard-summit", speakers: empty }));

    expect(html).toContain("Speakers coming soon");
    expect(html).not.toContain("View the agenda");
  });

  it("points the empty state at the agenda once the agenda has sessions", () => {
    const empty = { ...PUBLISHED_SPEAKERS_FIXTURE, speakers: [] };
    const html = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, { eventSlug: "openboard-summit", speakers: empty, hasSessions: true }));

    expect(html).toContain("View the agenda");
    expect(html).toContain('href="/e/openboard-summit/agenda"');
  });

  it("renders session time and room on the deep-linked speaker's detail panel", () => {
    const html = renderToStaticMarkup(React.createElement(PublicSpeakerGallery, {
      eventSlug: "openboard-summit",
      speakers: PUBLISHED_SPEAKERS_FIXTURE,
      initialSpeakerId: firstSpeaker.contactId,
    }));

    expect(html).toContain("Main Hall");
  });
});
