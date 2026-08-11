import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContactListRow } from "@/features/portal";
import { SpeakerFlowDrawer } from "./speaker-flow-drawer";

Object.assign(globalThis, { React });

const EVENT_ID = "a0000000-0000-4000-8000-000000000001";

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
      row: ROW,
      onClose: () => {},
    }));

    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Programmer");
    expect(html).toContain(`/events/${EVENT_ID}/speakers/${ROW.contactId}`);
    // Missing-asset note only when something is actually missing.
    expect(html).toContain("Missing headshot");
    // No nav prop supplied: no prev/next controls render.
    expect(html).not.toContain("flow-nav-controls");
  });

  it("shows the ranked position when nav is supplied", () => {
    const html = renderToStaticMarkup(React.createElement(SpeakerFlowDrawer, {
      eventId: EVENT_ID,
      row: ROW,
      onClose: () => {},
      nav: { index: 2, total: 9, onPrev: () => {}, onNext: () => {} },
    }));

    expect(html).toContain("3 of 9");
  });
});
