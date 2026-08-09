import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_FIXTURE_OVERVIEW, FIXTURE_OVERVIEW } from "../fixtures";
import { FormProgressCards } from "./FormProgressCards";
import { SpeakerTrackingPanel } from "./SpeakerTrackingPanel";
import { TodayPanel } from "./TodayPanel";

Object.assign(globalThis, { React });

describe("dashboard components", () => {
  it("renders every designed empty state without invalid percentages", () => {
    const speakerHtml = renderToStaticMarkup(React.createElement(SpeakerTrackingPanel, { overview: EMPTY_FIXTURE_OVERVIEW }));
    const todayHtml = renderToStaticMarkup(React.createElement(TodayPanel, { overview: EMPTY_FIXTURE_OVERVIEW, firstName: "Maya" }));

    expect(speakerHtml).toContain("No outstanding tasks");
    expect(speakerHtml).toContain("Nothing overdue");
    expect(speakerHtml).toContain("No data");
    expect(speakerHtml).not.toContain("dashboard-missing-alert");
    expect(todayHtml).toContain("No submission forms yet");
    expect(todayHtml).toContain("No submissions yet");
    expect(todayHtml).not.toContain("dashboard-attention-strip");
    expect(`${speakerHtml}${todayHtml}`).not.toContain("NaN");
  });

  it("uses the event slug for public form links and the id for admin links", () => {
    const html = renderToStaticMarkup(React.createElement(FormProgressCards, {
      eventId: FIXTURE_OVERVIEW.event.id,
      eventSlug: FIXTURE_OVERVIEW.event.slug,
      timezone: FIXTURE_OVERVIEW.event.timezone,
      forms: FIXTURE_OVERVIEW.forms,
    }));
    const formId = FIXTURE_OVERVIEW.forms[0]?.formId;

    expect(html).toContain(`/submit/${FIXTURE_OVERVIEW.event.slug}/${formId}`);
    expect(html).toContain(`/events/${FIXTURE_OVERVIEW.event.id}/forms/${formId}`);
    expect(html).not.toContain(`/submit/${FIXTURE_OVERVIEW.event.id}/`);
  });
});
