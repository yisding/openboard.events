import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { commLogIdSchema, contactIdSchema, eventIdSchema, type CommLogRow } from "@/shared/contracts";
import { QueryBoundary } from "@/shared/ui/app/query-boundary";
import { ToastProvider } from "@/shared/ui/toast";
import { commsKeys } from "../hooks/keys";
import { CommsLogTable } from "./comms-log-table";

Object.assign(globalThis, { React });

const eventId = eventIdSchema.parse("e6000000-0000-4000-8000-000000000001");
const contactId = contactIdSchema.parse("e6000000-0000-4000-8000-000000000002");

const ROW: CommLogRow = {
  id: commLogIdSchema.parse("e6000000-0000-4000-8000-000000000003"),
  contactId,
  recipientName: "Nadia Lee",
  recipientEmail: "nadia@example.com",
  templateKey: "portal_login",
  status: "sent",
  providerMessageId: "resend-abc123",
  subjectRendered: "Your sign-in code",
  createdAt: "2026-08-01T12:00:00.000Z",
  sentAt: "2026-08-01T12:00:04.000Z",
  error: null,
  icsUid: null,
  submissionId: null,
  sessionId: null,
  taskId: null,
};

function renderLog(rows: readonly CommLogRow[] = [ROW]): string {
  const filters = { contactId, limit: 500 };
  return renderToStaticMarkup(
    <ToastProvider>
      <QueryBoundary seeds={[{ queryKey: commsKeys.log(eventId, filters), data: rows }]}>
        <CommsLogTable eventId={eventId} contactId={contactId} timezone="America/Los_Angeles" />
      </QueryBoundary>
    </ToastProvider>,
  );
}

// The ≤1024/≤768 disclosure ladder in globals.css targets `comms-log-col-*`,
// which exists only if DataTable stamps it from these column definitions. The
// previous ladder was scoped to a `.comms-table` that had been deleted, and
// nothing failed — because the guard only ever read the stylesheet.
describe("CommsLogTable responsive column hooks", () => {
  it("stamps the comms-log-col-* class onto both th and td, for every column the ladder touches", () => {
    const html = renderLog();

    for (const column of ["recipient", "template", "subject", "provider", "created", "sent"]) {
      const className = `comms-log-col-${column}`;
      const occurrences = html.split(`class="${className}"`).length - 1;
      expect(occurrences, `${className} should appear on one <th> and one <td>`).toBe(2);
    }
  });

  it("leaves Status unclassed — it is the column this table exists to show", () => {
    expect(renderLog()).not.toContain("comms-log-col-status");
  });

  // Every row was "Portal sign-in · Nadia Lee · Sent" until this column landed:
  // nothing on the list said which of two messages from the same template was
  // which, so identifying a row meant opening it.
  it("identifies a row by the subject the recipient actually saw", () => {
    const html = renderLog();

    expect(html).toContain('class="table-sort">Subject</button>');
    expect(html).toContain('<td class="comms-log-col-subject"><span title="Your sign-in code">Your sign-in code</span></td>');
  });

  it("names templates the way every other surface does, never the raw enum key", () => {
    const html = renderLog();
    expect(html).toContain("Portal sign-in");
    expect(html).not.toContain("portal login");
  });
});

// A send the dispatcher stops before `renderTemplateContent` has no subject —
// on a demo event that is *every* send — and the column was a full screen of
// identical dashes with the reason hidden one drawer away.
describe("CommsLogTable rows that never rendered", () => {
  const skipped: CommLogRow = {
    ...ROW,
    templateKey: "schedule_assigned",
    status: "skipped",
    subjectRendered: null,
    providerMessageId: null,
    sentAt: null,
    error: "demo event — mail is never delivered",
  };

  it("shows why a skipped row has no subject instead of a bare dash", () => {
    const html = renderLog([skipped]);

    expect(html).toContain("demo event — mail is never delivered");
    expect(html).not.toContain('<td class="comms-log-col-subject"><span class="dash"');
  });

  it("keeps the dash for a row that simply has nothing to explain", () => {
    const html = renderLog([{ ...skipped, status: "queued", error: null }]);

    expect(html).toContain('<td class="comms-log-col-subject"><span class="dash"');
  });

  // A failed row with no subject is *not* proof it never rendered: the 90-day
  // retention job redacts the subject of rows that rendered fine while keeping
  // `error` for the audit trail. Only `skipped` — which always lands before
  // the render — may make the claim.
  it("does not claim a failed row never rendered — its subject may be retention-redacted", () => {
    const html = renderLog([{ ...skipped, status: "failed", error: "provider rejected the message" }]);

    expect(html).toContain('<td class="comms-log-col-subject"><span class="dash"');
    expect(html).not.toContain("log-unrendered-cell");
  });
});
