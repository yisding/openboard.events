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

function renderLog(): string {
  const filters = { contactId, limit: 500 };
  return renderToStaticMarkup(
    <ToastProvider>
      <QueryBoundary seeds={[{ queryKey: commsKeys.log(eventId, filters), data: [ROW] }]}>
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

    for (const column of ["recipient", "template", "provider", "created", "sent"]) {
      const className = `comms-log-col-${column}`;
      const occurrences = html.split(`class="${className}"`).length - 1;
      expect(occurrences, `${className} should appear on one <th> and one <td>`).toBe(2);
    }
  });

  it("leaves Status unclassed — it is the column this table exists to show", () => {
    expect(renderLog()).not.toContain("comms-log-col-status");
  });

  it("names templates the way every other surface does, never the raw enum key", () => {
    const html = renderLog();
    expect(html).toContain("Portal sign-in");
    expect(html).not.toContain("portal login");
  });
});
