import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContactListRow } from "@/features/portal";
import { SpeakerFlowDrawer } from "./speaker-flow-drawer";

Object.assign(globalThis, { React });

const EVENT_ID = "a0000000-0000-4000-8000-000000000001";
const TZ = "America/Los_Angeles";

const ROW: ContactListRow = {
  contactId: "a0000000-0000-4000-8000-000000000010" as ContactListRow["contactId"],
  name: "Ada Lovelace",
  email: "ada@example.com",
  jobTitle: "Programmer",
  company: "Analytical Engines",
  headshotFileId: null,
  confirmationStatus: "confirmed",
  isAcceptedSpeaker: true,
  submissionCount: 1,
  openTasks: 2,
  overdueTasks: 1,
  missingBio: false,
  missingHeadshot: true,
};

describe("SpeakerFlowDrawer", () => {
  it("renders the row's own data immediately, before any fetch resolves, plus a link to the full profile", () => {
    const html = renderToStaticMarkup(React.createElement(SpeakerFlowDrawer, {
      eventId: EVENT_ID,
      timezone: TZ,
      row: ROW,
      onClose: () => {},
    }));

    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Programmer");
    expect(html).toContain(`/events/${EVENT_ID}/speakers/${ROW.contactId}`);
    // Missing-asset note only when something is actually missing.
    expect(html).toContain("Missing headshot");
    // Submissions is never a bare heading: row data covers the in-flight fetch.
    expect(html).toContain("1 on this event");
    // No nav prop supplied: no prev/next controls render.
    expect(html).not.toContain("flow-nav-controls");
  });

  it("shows the ranked position when nav is supplied", () => {
    const html = renderToStaticMarkup(React.createElement(SpeakerFlowDrawer, {
      eventId: EVENT_ID,
      timezone: TZ,
      row: ROW,
      onClose: () => {},
      nav: { index: 2, total: 9, onPrev: () => {}, onNext: () => {} },
    }));

    expect(html).toContain("3 of 9");
  });

  // The tasks only render once the detail fetch resolves, so the guard is on
  // the source: a bare `<Dash value={task.dueAt} />` printed the stored instant
  // ("2026-08-14T00:00:00.000Z") straight into the drawer. Due dates belong in
  // the event's zone, like the same list on the full profile page.
  it("renders task due dates through the shared event-zone helper", () => {
    const source = readFileSync(`${process.cwd()}/src/features/portal/components/speakers-admin/speaker-flow-drawer.tsx`, "utf8");

    expect(source).toContain('<TzTime instant={task.dueAt} tz={timezone} style="date" />');
    expect(source).not.toContain("<Dash value={task.dueAt} />");
  });
});
