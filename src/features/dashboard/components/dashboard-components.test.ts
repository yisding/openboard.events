import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatInZone } from "@/shared/lib/time";
import { copyPublicFormLink, nextFormAvailabilityRefreshMs } from "@/features/forms/components/saved-form-actions";
import { EMPTY_FIXTURE_OVERVIEW, FIXTURE_OVERVIEW } from "../__fixtures__/overview";
import { resolveDashboardTab } from "../lib/dashboard-tab";
import { ToastProvider } from "@/shared/ui/toast";
import { ActivationGuide, resolveActivationState } from "./ActivationGuide";
import { AttentionQueue } from "./AttentionQueue";
import { FormProgressCards } from "./FormProgressCards";
import { OverdueList } from "./OverdueList";
import { RecentSubmissionsTable } from "./RecentSubmissionsTable";
import { SpeakerTrackingPanel } from "./SpeakerTrackingPanel";
import { TodayPanel } from "./TodayPanel";
import { TopSpeakersList } from "./TopSpeakersList";

Object.assign(globalThis, { React });

const globalCss = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

function renderActivation(overview: typeof FIXTURE_OVERVIEW) {
  return renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(ActivationGuide, { overview })));
}

function renderFormProgress(form: typeof FIXTURE_OVERVIEW.forms[number]) {
  return renderToStaticMarkup(React.createElement(
    ToastProvider,
    null,
    React.createElement(FormProgressCards, {
      eventId: FIXTURE_OVERVIEW.event.id,
      eventSlug: FIXTURE_OVERVIEW.event.slug,
      timezone: FIXTURE_OVERVIEW.event.timezone,
      forms: [form],
    }),
  ));
}

describe("dashboard components", () => {
  it("renders every designed empty state without invalid percentages", () => {
    const speakerHtml = renderToStaticMarkup(React.createElement(SpeakerTrackingPanel, { overview: EMPTY_FIXTURE_OVERVIEW }));
    const todayHtml = renderToStaticMarkup(React.createElement(TodayPanel, { overview: EMPTY_FIXTURE_OVERVIEW, firstName: "Maya" }));

    expect(speakerHtml).toContain("No outstanding tasks");
    expect(speakerHtml).toContain("Nothing overdue");
    expect(speakerHtml).toContain("No data");
    expect(speakerHtml).toContain("Ready for event workflows");
    expect(speakerHtml).not.toContain("accepted_speakers_v");
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
    expect(liveHtml).toContain(`/events/${liveOverview.event.id}/forms/${form.formId}/preview`);

    const draftOverview = { ...liveOverview, forms: [{ ...form, status: "draft" as const, availability: "draft" as const }] };
    expect(renderActivation(draftOverview)).toContain("Publish your call for speakers");

    const scheduledOverview = { ...liveOverview, forms: [{ ...form, availability: "scheduled" as const, opensAt: "2026-08-20T07:00:00.000Z" }] };
    const scheduledHtml = renderActivation(scheduledOverview);
    expect(scheduledHtml).toContain("Your call for speakers is scheduled");
    expect(scheduledHtml).not.toContain("Copy link");

    const endedOverview = { ...liveOverview, forms: [{ ...form, availability: "ended" as const, closesAt: "2026-08-07T07:00:00.000Z" }] };
    const endedHtml = renderActivation(endedOverview);
    expect(endedHtml).toContain("Extend your submission window");
    expect(endedHtml).not.toContain("Copy link");

    const closedOverview = { ...liveOverview, forms: [{ ...form, status: "closed" as const, availability: "closed" as const }] };
    expect(renderActivation(closedOverview)).toContain("Reopen your call for speakers");

    expect(resolveActivationState(FIXTURE_OVERVIEW)).toBeNull();
    expect(renderActivation(FIXTURE_OVERVIEW)).toBe("");
  });

  it("keeps milestone artwork visible instead of inheriting its text color", () => {
    expect(globalCss).toContain(".dashboard-milestone a span{font-size:var(--text-xs);color:var(--green)}");
    expect(globalCss).not.toContain(".dashboard-milestone span{font-size:var(--text-xs);color:var(--green)}");
  });

  const fixtureForm = FIXTURE_OVERVIEW.forms[0];
  if (!fixtureForm) throw new Error("Dashboard fixture must contain a form");
  const scheduledOpensAt = "2026-08-20T07:00:00.000Z";
  const endedClosesAt = "2026-08-07T07:00:00.000Z";
  const formVariants: Array<{
    availability: typeof fixtureForm.availability;
    form: typeof fixtureForm;
    timing: string;
  }> = [
    {
      availability: "draft",
      form: { ...fixtureForm, status: "draft", availability: "draft", opensAt: null, closesAt: null },
      timing: "Not published",
    },
    {
      availability: "scheduled",
      form: { ...fixtureForm, status: "open", availability: "scheduled", opensAt: scheduledOpensAt, closesAt: null },
      timing: `Opens ${formatInZone(scheduledOpensAt, FIXTURE_OVERVIEW.event.timezone, "date")}`,
    },
    {
      availability: "live",
      form: { ...fixtureForm, status: "open", availability: "live", opensAt: null, closesAt: null },
      timing: "No closing date",
    },
    {
      availability: "ended",
      form: { ...fixtureForm, status: "open", availability: "ended", opensAt: null, closesAt: endedClosesAt },
      timing: `Ended ${formatInZone(endedClosesAt, FIXTURE_OVERVIEW.event.timezone, "date")}`,
    },
    {
      availability: "closed",
      form: { ...fixtureForm, status: "closed", availability: "closed", opensAt: null, closesAt: null },
      timing: "Closed manually",
    },
  ];

  it.each(formVariants)("renders $availability form availability with a truthful action", ({ availability, form, timing }) => {
    const html = renderFormProgress(form);
    const manageHref = `/events/${FIXTURE_OVERVIEW.event.id}/forms/${form.formId}`;
    const previewHref = `${manageHref}/preview`;
    const publicHref = `/submit/${FIXTURE_OVERVIEW.event.slug}/${form.formId}`;

    expect(html).toContain(`data-status="${availability}"`);
    expect(html).toContain(timing);
    expect(html).toContain(`href="${manageHref}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');

    if (availability === "live") {
      expect(html).toContain(`href="${publicHref}"`);
      expect(html).toContain("Open live form");
      expect(html).toContain("Copy link");
      expect(html).toContain(`aria-label="Copy public link: ${form.name}"`);
      expect(html).toContain(`aria-label="Open live form: ${form.name} (opens in a new tab)"`);
      expect(html).not.toContain(`href="${previewHref}"`);
      expect(html).not.toContain(`/submit/${FIXTURE_OVERVIEW.event.id}/`);
    } else {
      expect(html).toContain(`href="${previewHref}"`);
      expect(html).toContain(">Preview</a>");
      expect(html).toContain(`aria-label="Preview form: ${form.name} (opens in a new tab)"`);
      expect(html).not.toContain(`/submit/${FIXTURE_OVERVIEW.event.slug}/`);
      expect(html).not.toContain("Copy link");
    }
  });

  it("keeps a live form shareable after the first submission", () => {
    const form = { ...fixtureForm, availability: "live" as const, submitted: 12 };
    const html = renderFormProgress(form);

    expect(html).toContain("Open live form");
    expect(html).toContain("Copy link");
  });

  it("falls back when the Clipboard API rejects a public-link copy", async () => {
    const clipboard = { writeText: async () => { throw new Error("denied"); } };
    const fallback = (value: string) => value === "https://events.test/submit/conf/form-1";

    await expect(copyPublicFormLink("/submit/conf/form-1", "https://events.test", clipboard, fallback)).resolves.toBe(true);
  });

  it("refreshes actions at the next saved availability boundary", () => {
    const now = new Date("2026-08-13T12:00:00.000Z").getTime();
    expect(nextFormAvailabilityRefreshMs({
      status: "open",
      opensAt: "2026-08-13T12:05:00.000Z",
      closesAt: "2026-08-13T13:00:00.000Z",
    }, now)).toBe(300_025);
    expect(nextFormAvailabilityRefreshMs({ status: "draft", opensAt: null, closesAt: null }, now)).toBeNull();
    expect(nextFormAvailabilityRefreshMs({ status: "open", opensAt: null, closesAt: new Date(now).toISOString() }, now)).toBeNull();
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

  it("opens each recent submission directly in the abstracts drawer", () => {
    const html = renderToStaticMarkup(React.createElement(RecentSubmissionsTable, {
      eventId: FIXTURE_OVERVIEW.event.id,
      timezone: FIXTURE_OVERVIEW.event.timezone,
      rows: FIXTURE_OVERVIEW.recentSubmissions,
    }));

    for (const row of FIXTURE_OVERVIEW.recentSubmissions) {
      expect(html).toContain(`/events/${FIXTURE_OVERVIEW.event.id}/abstracts?submission=${row.id}`);
    }
    expect(html).toContain("Open submission");
  });

  it("honors a valid requested dashboard tab and falls back otherwise", () => {
    expect(resolveDashboardTab("today", "speakers")).toBe("today");
    expect(resolveDashboardTab("speakers", "today")).toBe("speakers");
    expect(resolveDashboardTab("unknown", "today")).toBe("today");
  });
});
