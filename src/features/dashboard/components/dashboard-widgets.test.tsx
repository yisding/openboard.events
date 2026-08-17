/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPEAKERS_DEEPLINK_PARAMS } from "@/shared/contracts";
import { FIXTURE_OVERVIEW } from "../__fixtures__/overview";
import { ConfirmationMix } from "./ConfirmationMix";
import { KpiRow } from "./KpiRow";
import { MissingAssetsAlert } from "./MissingAssetsAlert";
import { StatusRow } from "./StatusRow";
import { WidgetBoundary } from "./WidgetBoundary";

/**
 * The six dashboard components `dashboard-components.test.ts` never imports.
 *
 * `WidgetBoundary` is the one that matters most and the one hardest to notice
 * breaking: it is the reason a single failing widget costs the organizer that
 * widget instead of the whole page, and nothing about it is visible until the
 * day something throws in production. It gets a real client render here —
 * `renderToStaticMarkup` does not run error boundaries at all, so a static
 * render would prove nothing about the only behaviour it has.
 *
 * `TourResumeCard`, the sixth, is exercised in `tour-resume-card.test.tsx`,
 * which needs a different set of module mocks.
 */

const logMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/log", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/shared/lib/log")>(),
  log: logMock,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  logMock.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function Boom({ message }: { message: string }): React.ReactNode {
  throw new Error(message);
}

describe("WidgetBoundary", () => {
  it("passes a healthy widget straight through", async () => {
    await act(async () => root.render(
      <WidgetBoundary name="kpis"><p>Twenty-five submissions</p></WidgetBoundary>,
    ));

    expect(container.textContent).toContain("Twenty-five submissions");
    expect(logMock).not.toHaveBeenCalled();
  });

  it("costs the organizer one widget, not the dashboard", async () => {
    // React logs a caught render error to the console; that noise is not the
    // behaviour under test.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await act(async () => root.render(
        <div>
          <WidgetBoundary name="confirmation-mix"><Boom message="mix blew up" /></WidgetBoundary>
          <WidgetBoundary name="statuses"><p>Submission status</p></WidgetBoundary>
        </div>,
      ));
    } finally {
      consoleError.mockRestore();
    }

    // The failed widget renders nothing at all — no error card, no empty
    // shell that reads as "there is nothing here".
    expect(container.textContent).toBe("Submission status");
  });

  it("names the widget that failed, so the log says which one to go and look at", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await act(async () => root.render(
        <WidgetBoundary name="confirmation-mix"><Boom message="mix blew up" /></WidgetBoundary>,
      ));
    } finally {
      consoleError.mockRestore();
    }

    expect(logMock).toHaveBeenCalledTimes(1);
    const entry = logMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "error",
      msg: "dashboard.widget_failed",
      requestId: "client",
      feature: "dashboard",
      code: "confirmation-mix",
      error: "mix blew up",
    });
    // Without a stack and a component stack the line says a widget broke and
    // nothing about where, which is barely better than silence.
    expect(entry.stack).toEqual(expect.stringContaining("Error: mix blew up"));
    expect(entry.componentStack).toEqual(expect.any(String));
  });
});

describe("KpiRow", () => {
  it("keeps every headline number attached to its own label", () => {
    const html = renderToStaticMarkup(<KpiRow kpis={FIXTURE_OVERVIEW.kpis} />);
    const pairs = [...html.matchAll(/<strong>(\d+)<\/strong><b>([^<]+)<\/b><small>([^<]+)<\/small>/g)]
      .map(([, value, label, hint]) => [label, Number(value), hint]);

    // A swapped pair here is the classic dashboard lie: the number is real, it
    // just belongs to a different question.
    expect(pairs).toEqual([
      ["Submissions", 25, "Non-draft"],
      ["Accepted speakers", 12, "Unique contacts"],
      ["Scheduled sessions", 9, "Published with a time"],
      ["Unscheduled accepted", 3, "Need a time slot"],
    ]);
  });
});

describe("StatusRow", () => {
  it("folds each queue state into the decision tile it is on its way to", () => {
    const { accepted, accept_queue, declined, decline_queue, pending, draft, withdrawn } = FIXTURE_OVERVIEW.statusCounts;
    const html = renderToStaticMarkup(<StatusRow counts={FIXTURE_OVERVIEW.statusCounts} />);
    const tiles = [...html.matchAll(/<strong>(\d+)<\/strong><span>([^<]+)<\/span>/g)]
      .map(([, count, label]) => [label, Number(count)]);

    expect(tiles).toEqual([
      // A submission sitting in the accept queue has been accepted; showing 12
      // here while the abstracts table says 13 is the discrepancy this folding
      // exists to prevent.
      ["Accepted", accepted + accept_queue],
      ["Pending", pending],
      ["Declined", declined + decline_queue],
      ["Drafts", draft],
      ["Withdrawn", withdrawn],
    ]);
    // Every tile carries the sentence explaining what it does and does not
    // count — the tooltip is the whole reason the folding is defensible.
    expect(html).toContain('title="Accepted includes the accept queue."');
    expect(html).toContain('title="Drafts are excluded from the Submissions KPI."');
  });
});

describe("ConfirmationMix", () => {
  it("lays the three arcs end to end around the ring", () => {
    const mix = FIXTURE_OVERVIEW.speakerTracking.confirmationMix;
    const total = mix.confirmed + mix.unconfirmed + mix.declined;
    const html = renderToStaticMarkup(<ConfirmationMix mix={mix} />);
    const arcs = [...html.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)" stroke-dashoffset="(-?[\d.]+)"/g)]
      .map(([, length, gap, offset]) => ({ length: Number(length), gap: Number(gap), offset: Number(offset) }));

    expect(arcs).toHaveLength(3);
    // Each arc's own length plus its gap covers the whole ring, and each one
    // starts exactly where the previous one ended — an offset that stops
    // accumulating stacks all three on top of each other and the donut lies.
    let expectedOffset = 0;
    for (const [index, arc] of arcs.entries()) {
      const share = ([mix.confirmed, mix.unconfirmed, mix.declined][index] ?? 0) / total * 100;
      expect(arc.length).toBeCloseTo(share, 6);
      expect(arc.length + arc.gap).toBeCloseTo(100, 6);
      expect(arc.offset).toBeCloseTo(-expectedOffset, 6);
      expectedOffset += share;
    }
    expect(expectedOffset).toBeCloseTo(100, 6);

    // The donut is decoration for a screen reader; the label is the data.
    expect(html).toContain(`aria-label="${mix.confirmed} confirmed, ${mix.unconfirmed} unconfirmed, ${mix.declined} declined"`);
    expect(html).toContain(`>${total}</text>`);
  });

  it("shows the designed empty state rather than a ring of NaN", () => {
    const html = renderToStaticMarkup(<ConfirmationMix mix={{ confirmed: 0, unconfirmed: 0, declined: 0 }} />);

    expect(html).toContain("No data");
    expect(html).toContain("Accept a submission to see confirmation status.");
    // 0/0 is the arithmetic this guard exists for: without it every arc, every
    // legend percentage and the centre count render `NaN`.
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("stroke-dasharray");
  });
});

describe("MissingAssetsAlert", () => {
  const eventId = FIXTURE_OVERVIEW.event.id;

  it("says nothing when nothing is missing", () => {
    expect(renderToStaticMarkup(
      <MissingAssetsAlert eventId={eventId} missing={{ speakers: 0, bios: 0, headshots: 0 }} />,
    )).toBe("");
  });

  it("deep-links into the speakers list already filtered to the people it is talking about", () => {
    const html = renderToStaticMarkup(
      <MissingAssetsAlert eventId={eventId} missing={FIXTURE_OVERVIEW.speakerTracking.missingAssets} />,
    );

    // The filter value is the contract's, not a string spelled out twice: a
    // rename on that side must not leave this link pointing at nothing.
    expect(html).toContain(`href="/events/${eventId}/speakers?missing=${SPEAKERS_DEEPLINK_PARAMS.missing[2]}"`);
  });

  it("counts in English on both sides of one", () => {
    const many = renderToStaticMarkup(
      <MissingAssetsAlert eventId={eventId} missing={{ speakers: 2, bios: 2, headshots: 1 }} />,
    );
    const one = renderToStaticMarkup(
      <MissingAssetsAlert eventId={eventId} missing={{ speakers: 1, bios: 0, headshots: 1 }} />,
    );

    expect(many).toContain("2 accepted speakers are missing a bio or headshot");
    expect(many).toContain("(2 bios, 1 headshot)");
    expect(one).toContain("1 accepted speaker is missing a bio or headshot");
    expect(one).toContain("(0 bios, 1 headshot)");
  });
});
