import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_FIXTURE_OVERVIEW, FIXTURE_OVERVIEW } from "../fixtures";
import { resolveDashboardTab, resolveLocalDashboardEventId } from "../lib/dashboard-tab";
import { DEMO_EVENT_ID } from "@/shared/demo/seed";
import { ToastProvider } from "@/shared/ui/toast";
import { ActivationGuide, resolveActivationState } from "./ActivationGuide";
import { AttentionQueue } from "./AttentionQueue";
import { FormProgressCards } from "./FormProgressCards";
import { OverdueList } from "./OverdueList";
import { SpeakerTrackingPanel } from "./SpeakerTrackingPanel";
import { TodayPanel } from "./TodayPanel";
import { TopSpeakersList } from "./TopSpeakersList";

Object.assign(globalThis, { React });

function renderActivation(overview: typeof FIXTURE_OVERVIEW) {
  return renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(ActivationGuide, { overview })));
}

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
    // The attention queue lives above the tabs now (`DashboardTabsInner`), not
    // inside either tab panel — `TodayPanel` on its own never renders it.
    expect(todayHtml).not.toContain("dashboard-attention-queue");
    expect(`${speakerHtml}${todayHtml}`).not.toContain("NaN");
  });

  it("renders nothing when there is nothing to attend to, and a ranked, clickable list when there is", () => {
    expect(renderToStaticMarkup(React.createElement(AttentionQueue, { items: [] }))).toBe("");

    const html = renderToStaticMarkup(React.createElement(AttentionQueue, { items: FIXTURE_OVERVIEW.attention }));
    // Every item renders — no cap, no "+N more": this is the primary surface now.
    for (const item of FIXTURE_OVERVIEW.attention) {
      expect(html).toContain(`href="${item.href}"`);
    }
    // Ranked by count, most urgent first: the fixture's counts are 3, 7, 2 for
    // unscheduled/awaiting-decision/missing-assets, so "awaiting a decision"
    // (7) leads and "missing a bio or headshot" (2) trails.
    const decisionIndex = html.indexOf("awaiting a decision");
    const unscheduledIndex = html.indexOf("still need a time slot");
    const missingIndex = html.indexOf("missing a bio or headshot");
    expect(decisionIndex).toBeGreaterThan(-1);
    expect(decisionIndex).toBeLessThan(unscheduledIndex);
    expect(unscheduledIndex).toBeLessThan(missingIndex);
  });

  it("guides a new event from form creation through its first submitted proposal", () => {
    expect(resolveActivationState(EMPTY_FIXTURE_OVERVIEW)).toEqual({ kind: "no_form" });
    const noFormHtml = renderActivation(EMPTY_FIXTURE_OVERVIEW);
    expect(noFormHtml).toContain("Create your call for speakers");
    expect(noFormHtml).toContain(`/events/${EMPTY_FIXTURE_OVERVIEW.event.id}/forms`);

    const fixtureForm = FIXTURE_OVERVIEW.forms[0];
    if (!fixtureForm) throw new Error("Dashboard fixture must contain a form");
    const form = { ...fixtureForm, submitted: 0 };
    const liveOverview = {
      ...EMPTY_FIXTURE_OVERVIEW,
      event: { ...EMPTY_FIXTURE_OVERVIEW.event, slug: "new-conference" },
      forms: [form],
    };
    const liveHtml = renderActivation(liveOverview);
    expect(resolveActivationState(liveOverview)).toEqual({ kind: "live", form });
    expect(liveHtml).toContain("Get your first submission");
    expect(liveHtml).toContain(`/submit/new-conference/${form.formId}`);
    expect(liveHtml).toContain(`/events/${liveOverview.event.id}/forms/${form.formId}`);

    const draftOverview = { ...liveOverview, forms: [{ ...form, status: "draft" as const, availability: "draft" as const }] };
    expect(renderActivation(draftOverview)).toContain("Publish your call for speakers");

    const scheduledOverview = { ...liveOverview, forms: [{ ...form, availability: "scheduled" as const, opensAt: "2026-08-20T07:00:00.000Z" }] };
    const scheduledHtml = renderActivation(scheduledOverview);
    expect(scheduledHtml).toContain("Your call for speakers is scheduled");
    expect(scheduledHtml).not.toContain("Copy link");

    const expiredOverview = { ...liveOverview, forms: [{ ...form, availability: "expired" as const, closesAt: "2026-08-07T07:00:00.000Z" }] };
    const expiredHtml = renderActivation(expiredOverview);
    expect(expiredHtml).toContain("Extend your submission window");
    expect(expiredHtml).not.toContain("Copy link");

    const closedOverview = { ...liveOverview, forms: [{ ...form, status: "closed" as const, availability: "closed" as const }] };
    expect(renderActivation(closedOverview)).toContain("Reopen your call for speakers");

    expect(resolveActivationState(FIXTURE_OVERVIEW)).toBeNull();
    expect(renderActivation(FIXTURE_OVERVIEW)).toBe("");
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

  it("routes speaker task rows through the implemented list drawer", () => {
    const topHtml = renderToStaticMarkup(React.createElement(TopSpeakersList, {
      eventId: FIXTURE_OVERVIEW.event.id,
      rows: FIXTURE_OVERVIEW.speakerTracking.topByOutstanding,
    }));
    const overdueHtml = renderToStaticMarkup(React.createElement(OverdueList, {
      eventId: FIXTURE_OVERVIEW.event.id,
      timezone: FIXTURE_OVERVIEW.event.timezone,
      rows: FIXTURE_OVERVIEW.speakerTracking.overdue,
    }));
    const contactId = FIXTURE_OVERVIEW.speakerTracking.topByOutstanding[0]?.contactId;

    expect(topHtml).toContain(`/events/${FIXTURE_OVERVIEW.event.id}/speakers?contactId=${contactId}`);
    expect(overdueHtml).toContain("/speakers?contactId=");
    expect(`${topHtml}${overdueHtml}`).not.toContain(`/speakers/${contactId}`);
  });

  it("honors a valid requested dashboard tab and falls back otherwise", () => {
    expect(resolveDashboardTab("today", "speakers")).toBe("today");
    expect(resolveDashboardTab("speakers", "today")).toBe("speakers");
    expect(resolveDashboardTab("unknown", "today")).toBe("today");
  });

  it("accepts the non-UUID seeded event only in the local dashboard resolver", () => {
    expect(resolveLocalDashboardEventId(DEMO_EVENT_ID)).toBe(DEMO_EVENT_ID);
    expect(resolveLocalDashboardEventId(FIXTURE_OVERVIEW.event.id)).toBe(FIXTURE_OVERVIEW.event.id);
    expect(resolveLocalDashboardEventId("not-an-event")).toBeNull();
  });
});
