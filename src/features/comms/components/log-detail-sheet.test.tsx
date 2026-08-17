import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { commLogIdSchema, contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { QueryBoundary } from "@/shared/ui/app/query-boundary";
import { ToastProvider } from "@/shared/ui/toast";
import { commsKeys } from "../hooks/keys";
import type { CommLogDetailWithFlag } from "../schemas";
import { LogDetailSheet } from "./log-detail-sheet";

Object.assign(globalThis, { React });

const eventId = eventIdSchema.parse("e6000000-0000-4000-8000-000000000001");
const contactId = contactIdSchema.parse("e6000000-0000-4000-8000-000000000002");
const logId = commLogIdSchema.parse("e6000000-0000-4000-8000-000000000003");

const DETAIL: CommLogDetailWithFlag = {
  id: logId,
  contactId,
  recipientName: "Nadia Lee",
  recipientEmail: "nadia@example.com",
  templateKey: "task_reminder",
  status: "sent",
  subjectRendered: "Two tasks are due Friday",
  bodyRenderedHtml: '<p>Hello Nadia</p><p><a href="https://portal.example.com/x">Open your portal</a></p>',
  bodyRenderedText: "Hello Nadia\n\nOpen your portal (https://portal.example.com/x)",
  providerMessageId: "resend-abc123",
  error: null,
  icsUid: null,
  submissionId: null,
  sessionId: null,
  taskId: null,
  idempotencyKey: "key-1",
  attempts: 1,
  createdAt: "2026-08-01T12:00:00.000Z",
  sentAt: "2026-08-01T12:00:04.000Z",
  previewFallback: false,
};

function renderSheet(detail: CommLogDetailWithFlag): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <QueryBoundary seeds={[{ queryKey: commsKeys.logDetail(eventId, logId), data: detail }]}>
        <LogDetailSheet eventId={eventId} logId={logId} timezone="America/Los_Angeles" onClose={() => undefined} />
      </QueryBoundary>
    </ToastProvider>,
  );
}

// Templates and bulk compose both let an organizer read the text/plain
// alternative of a message; the audit surface, where "what did this person
// actually receive?" is the whole question, showed only the rich body.
describe("LogDetailSheet message format", () => {
  it("offers the same plain-text alternative the other comms surfaces do", () => {
    const html = renderSheet(DETAIL);

    expect(html).toContain('role="group" aria-label="Message format"');
    expect(html).toContain(">HTML</button>");
    expect(html).toContain(">Plain text</button>");
  });

  it("keeps both bodies mounted, showing the rich one first", () => {
    const html = renderSheet(DETAIL);

    expect(html).toContain("Hello Nadia\n\nOpen your portal (https://portal.example.com/x)");
    expect(html).toContain("template-preview-plain-text");
    // The rich view is the one on screen until the organizer switches.
    expect(html).toMatch(/class="rendered-email template-preview-plain-text" hidden/u);
    expect(html).not.toMatch(/class="rendered-email" hidden/u);
  });

  it("shows no switch at all for a row whose body was never captured", () => {
    const html = renderSheet({ ...DETAIL, bodyRenderedHtml: null, bodyRenderedText: null });

    expect(html).toContain("Body not captured.");
    expect(html).not.toContain("Message format");
    expect(html).not.toContain("Plain text");
  });
});

// Every send on a demo event is skipped before it renders, so this drawer is
// where an organizer lands asking "why is there nothing here?".
describe("LogDetailSheet rows that never rendered", () => {
  const skipped: CommLogDetailWithFlag = {
    ...DETAIL,
    templateKey: "schedule_assigned",
    status: "skipped",
    subjectRendered: null,
    bodyRenderedHtml: null,
    bodyRenderedText: null,
    providerMessageId: null,
    sentAt: null,
    error: "demo event — mail is never delivered",
  };

  it("says why there is no body, rather than reporting it as lost", () => {
    const html = renderSheet(skipped);

    expect(html).toContain("Skipped before this message was rendered");
    expect(html).toContain("demo event — mail is never delivered");
    expect(html).not.toContain("Body not captured.");
  });

  it("labels the missing subject instead of leaving a bare dash", () => {
    expect(renderSheet(skipped)).toContain("Not rendered");
  });
});
