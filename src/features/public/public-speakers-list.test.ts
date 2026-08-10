import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PUBLISHED_SPEAKERS_FIXTURE } from "@/shared/fixtures/sessions";
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
});
