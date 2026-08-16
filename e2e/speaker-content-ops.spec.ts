import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin, loginAsSpeaker } from "./helpers/auth";
import { deleteAgendaSessionsWhere } from "./helpers/cleanup";
import { queryRows } from "./helpers/db";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { EVENTS, SESSIONS, TASKS, VOCAB, uniqueEmail } from "./helpers/seeded";

/**
 * M51 — standalone speaker roster operations, against the deployed preview.
 *
 * The point of running this in a browser/against the deployed API rather than
 * PGlite is the part PGlite cannot see: that a manually added speaker and an
 * imported row land through the exact same normalized-email identity CFP
 * submissions use, that an invited speaker's OTP challenge is real and signs
 * them in, that a browser upload's R2 object is what the organizer's download
 * link actually opens, and that a bulk send's queued/skipped counts match a
 * fresh read of the real outbox.
 */

const EVENT = EVENTS.main.id;
const SPEAKERS = `/api/internal/speakers/${EVENT}`;

type SpeakerDetail = {
  contact: { contactId: string; name: string; email: string; company: string | null; jobTitle: string | null; confirmationStatus: string };
};
type RosterExtras = {
  workflowStatus: string;
  fields: Array<{ id: string; key: string; label: string }>;
  values: Array<{ fieldId: string; value: string }>;
  unavailability: Array<{ id: string; startsAt: string; endsAt: string; reason: string | null }>;
  uploads: Array<{ fileId: string; filename: string }>;
};
type ImportResult = {
  rows: Array<{ rowNumber: number; email: string | null; status: string; changedFields: string[]; error: string | null }>;
  valid: number; invalid: number; committed: number;
};
type SpeakerRow = { contactId: string; name: string; email: string; openTasks: number; isAcceptedSpeaker: boolean };

async function speakerWithOpenFileRequest(request: APIRequestContext): Promise<SpeakerRow> {
  await loginAsAdmin(request);
  const list = await apiData<{ rows: SpeakerRow[] }>(request, `${SPEAKERS}?accepted=1&sort=openTasks&dir=desc&pageSize=100`);
  const found = list.rows.find((row) => row.openTasks > 0);
  expect(found, "the portal seed assigns a file-request task to at least one accepted speaker").toBeTruthy();
  return found as SpeakerRow;
}

test.describe("speaker-content-ops", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  // These are single long round trips — roster, import, invite, a real browser
  // upload through presign→PUT→finalize, bulk send — and the upload step alone
  // is allowed 60 s. Playwright's 30 s default expired *inside* that wait, so
  // the run reported "`.portal-uploads` not found" for an upload that simply
  // had not been given its own stated budget. The assertions are unchanged.
  test.beforeEach(({}, testInfo) => { testInfo.setTimeout(240_000); });

  test("an organizer builds a roster manually, by import, invites a speaker, sees an upload, and sends a bulk email", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    let speakerA: { contactId: string; email: string };
    let speakerB: { contactId: string; email: string };
    let logisticsFieldId: string;

    await test.step("two speakers are added manually and persist a full profile/workflow/logistics edit", async () => {
      const field = await apiData<{ id: string; key: string; label: string }>(request, `${SPEAKERS}/logistics-fields`, {
        method: "POST",
        data: { key: `e2e_shirt_${Date.now()}`, label: "Shirt size", fieldType: "select", options: ["S", "M", "L"] },
      });
      logisticsFieldId = field.id;

      const emailA = uniqueEmail("roster-a");
      const detailA = await apiData<SpeakerDetail>(request, SPEAKERS, {
        method: "POST",
        data: { email: emailA, firstName: "Ada", lastName: "Roster", jobTitle: "Engineer", company: "Acme", workflowStatus: "contacted" },
      });
      expect(detailA.contact.company).toBe("Acme");
      speakerA = { contactId: detailA.contact.contactId, email: emailA };

      const emailB = uniqueEmail("roster-b");
      const detailB = await apiData<SpeakerDetail>(request, SPEAKERS, { method: "POST", data: { email: emailB, firstName: "Grace" } });
      speakerB = { contactId: detailB.contact.contactId, email: emailB };

      const extrasBefore = await apiData<RosterExtras>(request, `${SPEAKERS}/${speakerA.contactId}/roster`);
      expect(extrasBefore.workflowStatus).toBe("contacted");

      const extrasAfter = await apiData<RosterExtras>(request, `${SPEAKERS}/${speakerA.contactId}/roster`, {
        method: "PATCH",
        data: { workflowStatus: "confirmed", logisticsValues: { [logisticsFieldId]: "M" } },
      });
      expect(extrasAfter.workflowStatus).toBe("confirmed");
      expect(extrasAfter.values).toEqual([{ fieldId: logisticsFieldId, value: "M" }]);

      // The organizer surface, not just the API: the speaker detail page
      // renders the field this run just created and the value just saved.
      await page.goto(`/events/${EVENT}/speakers/${speakerA.contactId}`);
      await expect(page.getByText("Shirt size")).toBeVisible();
      await expect(page.locator("select", { hasText: "M" }).first()).toBeVisible();
    });

    await test.step("a blackout entered in the event timezone reads back unchanged, in UTC", async () => {
      const intervals = [{ startsAt: "2026-09-16T16:00:00.000Z", endsAt: "2026-09-16T18:00:00.000Z", reason: "e2e flight" }];
      await apiData(request, `${SPEAKERS}/${speakerA.contactId}/unavailability`, { method: "PUT", data: { intervals } });

      const read = await apiData<{ intervals: RosterExtras["unavailability"] }>(request, `${SPEAKERS}/${speakerA.contactId}/unavailability`);
      expect(read.intervals).toEqual([expect.objectContaining({
        startsAt: "2026-09-16T16:00:00.000Z",
        endsAt: "2026-09-16T18:00:00.000Z",
        reason: "e2e flight",
      })]);
    });

    await test.step("CSV import upserts two existing emails and one new row, without duplicates, and errors are reported per row", async () => {
      const newEmail = uniqueEmail("roster-new");
      const csvText = [
        "Email,First name,Company",
        `${speakerA.email},Should Not Overwrite,Should Not Land`,
        `${speakerB.email},Grace,New Co`,
        `${newEmail},Newcomer,New Co`,
        "not-an-email,Bad Row,",
      ].join("\r\n");
      const mapping = { email: 0, fields: { firstName: 1, company: 2 } };

      const preview = await apiData<ImportResult>(request, `${SPEAKERS}/import`, { method: "POST", data: { csvText, mapping, mode: "preview" } });
      expect(preview.valid).toBe(3);
      expect(preview.invalid).toBe(1);
      const rowA = preview.rows.find((row) => row.email === speakerA.email);
      // speakerA already has firstName/company set — CSV import never
      // silently overwrites a non-empty field.
      expect(rowA?.changedFields).toEqual([]);

      const commit = await apiData<ImportResult>(request, `${SPEAKERS}/import`, { method: "POST", data: { csvText, mapping, mode: "commit" } });
      expect(commit.committed).toBe(3);

      const detailA = await apiData<SpeakerDetail>(request, `${SPEAKERS}/${speakerA.contactId}`);
      expect(detailA.contact.company, "import must not overwrite the company the organizer set by hand").toBe("Acme");

      const newContacts = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM contacts WHERE event_id = $1 AND email = $2",
        [EVENT, newEmail.toLowerCase()],
      );
      expect(Number(newContacts[0]?.n ?? 0)).toBe(1);

      // Retrying the identical commit lands the new contact exactly once.
      await apiData<ImportResult>(request, `${SPEAKERS}/import`, { method: "POST", data: { csvText, mapping, mode: "commit" } });
      const afterRetry = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM contacts WHERE event_id = $1 AND email = $2",
        [EVENT, newEmail.toLowerCase()],
      );
      expect(Number(afterRetry[0]?.n ?? 0)).toBe(1);
    });

    await test.step("inviting a speaker delivers a real portal session and a communication-log row", async () => {
      const before = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND contact_id = $2 AND template_key = 'portal_login'",
        [EVENT, speakerB.contactId],
      );
      const invite = await apiData<{ message: string }>(request, `${SPEAKERS}/${speakerB.contactId}/invite`, { method: "POST" });
      expect(invite.message).toBeTruthy();
      const after = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND contact_id = $2 AND template_key = 'portal_login'",
        [EVENT, speakerB.contactId],
      );
      expect(Number(after[0]?.n ?? 0)).toBeGreaterThan(Number(before[0]?.n ?? 0));

      // The confirmation is not just a log row: the invited speaker actually
      // signs in through the normal challenge M06b built.
      const speakerPage = await page.context().newPage();
      await loginAsSpeaker(speakerPage, EVENTS.main.slug, speakerB.email);
      await expect(speakerPage).toHaveURL(new RegExp(`/portal/${EVENTS.main.slug}(?!/login)`));
      await speakerPage.close();
    });

    await test.step("an organizer sees an uploaded asset's metadata and can download it", async () => {
      const uploader = await speakerWithOpenFileRequest(request);
      const speakerPage = await page.context().newPage();
      await loginAsSpeaker(speakerPage, EVENTS.main.slug, uploader.email);
      await speakerPage.goto(`/portal/${EVENTS.main.slug}/tasks`);
      await speakerPage.getByRole("link", { name: new RegExp(TASKS.fileRequest.name) }).first().click();
      const filename = `e2e-roster-upload-${Date.now()}.pdf`;
      await speakerPage.locator('.file-upload input[type="file"]').setInputFiles({
        name: filename,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
      });
      await expect(speakerPage.locator(".portal-uploads")).toContainText(filename, { timeout: 60_000 });
      await speakerPage.close();

      const extras = await apiData<RosterExtras>(request, `${SPEAKERS}/${uploader.contactId}/roster`);
      const uploaded = extras.uploads.find((row) => row.filename === filename);
      expect(uploaded, "the organizer-visible uploads list should include the file the speaker just sent").toBeTruthy();

      // The organizer's own page renders it, and the download link resolves
      // to a real, authorized R2 URL — never widened to another event.
      await page.goto(`/events/${EVENT}/speakers/${uploader.contactId}`);
      await expect(page.getByText(filename)).toBeVisible();
      const downloadResponse = await page.request.get(`/api/uploads/${uploaded?.fileId}/download-url`);
      expect(downloadResponse.ok()).toBeTruthy();
      const downloadUrl = (await downloadResponse.json() as { data?: { url?: string } }).data?.url;
      expect(downloadUrl).toContain("http");
    });

    await test.step("a personalized bulk send resolves a preview, queues one message per recipient, and reports accurate totals", async () => {
      const contactIds = [speakerA.contactId, speakerB.contactId];
      const subject = `e2e note {{speaker.first_name}} ${Date.now()}`;
      const bodyHtml = "<p>Hello {{speaker.first_name}}, this is an e2e message about {{event.name}}.</p>";
      const sendId = crypto.randomUUID();

      const preview = await apiData<{ preview: { subject: string; bodyHtml: string } | null }>(request, `${SPEAKERS}/bulk-email`, {
        method: "POST",
        data: { contactIds, subject, bodyHtml, mode: "preview", previewContactId: speakerA.contactId },
      });
      expect(preview.preview?.subject).toContain("Ada");
      expect(preview.preview?.bodyHtml).toContain("Ada");

      const before = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND template_key = 'speaker_bulk_message'",
        [EVENT],
      );
      const send = await apiData<{ queued: number; alreadyQueued: number; skipped: number; errors: unknown[] }>(request, `${SPEAKERS}/bulk-email`, {
        method: "POST",
        data: { contactIds, subject, bodyHtml, mode: "send", sendId },
      });
      expect(send.queued).toBe(2);
      expect(send.alreadyQueued).toBe(0);
      expect(send.errors).toEqual([]);
      const recovered = await apiData<{ queued: number; alreadyQueued: number; errors: unknown[] }>(request, `${SPEAKERS}/bulk-email`, {
        method: "POST",
        data: { contactIds, subject, bodyHtml, mode: "send", sendId },
      });
      expect(recovered).toMatchObject({ queued: 0, alreadyQueued: 2, errors: [] });
      const after = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND template_key = 'speaker_bulk_message'",
        [EVENT],
      );
      expect(Number(after[0]?.n ?? 0) - Number(before[0]?.n ?? 0)).toBe(2);

      const rows = await queryRows<{ contact_id: string }>(
        "SELECT contact_id FROM communication_logs WHERE event_id = $1 AND template_key = 'speaker_bulk_message' ORDER BY created_at DESC LIMIT 2",
        [EVENT],
      );
      expect(rows.map((row) => row.contact_id).sort()).toEqual([...contactIds].sort());
    });

    assertClean();
  });

  test.describe("without a database the assertions above cannot be made", () => {
    test.skip(databaseConfigured(), NO_DATABASE);
    test("is skipped", () => { expect(databaseConfigured()).toBe(false); });
  });
});

/**
 * M52 — content and deliverables lifecycle, against the deployed preview.
 *
 * The point of running this in a browser/against the deployed API rather than
 * PGlite is the part PGlite cannot see: that a second real browser upload to
 * the same slot is what actually numbers a version and flips the latest
 * marker for both roles, that the organizer's central Files view renders a
 * server round trip's rows rather than a fixture, that a restored session
 * never leaks onto the public schedule until it is explicitly published, and
 * that the export job's ZIP is real bytes read back from R2 through the
 * dependency-free writer in `zip.ts` — not merely a job row that says
 * `completed`.
 */

const DELIVERABLES = "/api/internal/deliverables";
const AGENDA_SESSIONS = "/api/internal/agenda/sessions";
const FILES_PAGE = `/events/${EVENT}/files`;

type DeliverableRow = {
  taskId: string;
  taskName: string;
  fileRequestId: string;
  fileRequestTitle: string;
  contactId: string;
  contactName: string;
  submissionId: string | null;
  completed: boolean;
  overdue: boolean;
  latestVersion: { fileUploadId: string; fileAssetId: string; version: number; isLatest: boolean; filename: string } | null;
  versionCount: number;
  commentCount: number;
};
type FileVersion = { fileUploadId: string; fileAssetId: string; version: number; isLatest: boolean; filename: string };
type FileComment = { id: string; authorRole: "organizer" | "speaker"; authorName: string; body: string; createdAt: string };
type ExportJob = { id: string; status: "pending" | "processing" | "completed" | "failed"; entryCount: number; resultFileId: string | null; error: string | null };
type SessionRow = { id: string; title: string; descriptionHtml: string; status: string; startsAt: string | null; rowVersion: number };
type SessionRevision = { id: string; title: string; editedByName: string | null; restoredFromRevisionId: string | null; createdAt: string };
// MTP-07: the endpoint now answers with both halves of a session's history —
// content edits and recorded placement moves.
type SessionPlacement = { id: string; from: { roomName: string | null }; to: { roomName: string | null }; movedByName: string | null };
type SessionHistory = { content: SessionRevision[]; placements: SessionPlacement[] };
type PublicSession = { title: string };

/** A minimal, sequential reader for the STORE-only ZIP `zip.ts` builds: local file headers back to back, no data descriptors. */
function readStoredZipNames(buffer: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    names.push(buffer.toString("utf8", nameStart, nameStart + nameLength));
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return names;
}

/** Polls the export job's own GET route, which processes an unclaimed job inline — see its own doc comment. */
async function settleExportJob(request: APIRequestContext, jobId: string): Promise<ExportJob> {
  let last: ExportJob | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await apiData<ExportJob>(request, `${DELIVERABLES}/export/${jobId}?eventId=${encodeURIComponent(EVENT)}`);
    if (last.status === "completed" || last.status === "failed") return last;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`export job ${jobId} never settled: ${JSON.stringify(last)}`);
}

// A 1x1 transparent PNG — small enough that `FileUpload`'s downscale step is a
// no-op (scale === 1 at any `maxEdge`), so the browser never has to round-trip
// through a canvas for this test to prove the organizer's headshot path works.
const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test.describe("content-deliverables (M52)", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.afterEach(async ({ request }) => {
    if (!targetConfigured()) return;
    await loginAsAdmin(request);
    await deleteAgendaSessionsWhere(request, EVENT, ({ title }) =>
      /^E2E content history (original|edit one|edit two) [0-9]+$/.test(title));
  });

  // Same budget as M51's block above, for the same reason: two real uploads,
  // a comment exchange, a bulk reminder through the outbox, a restore/publish
  // and a ZIP download do not fit in 30 s, and the 60 s upload waits inside
  // them cannot even complete.
  test.beforeEach(({}, testInfo) => { testInfo.setTimeout(240_000); });

  test("versions, comments, filtered reminders, session-content restore/publish, bio/headshot edit, and a grouped ZIP export", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    const uploader = await speakerWithOpenFileRequest(request);
    let slidesRequestId = "";
    let slidesSubmissionId: string | null = null;
    const stamp = Date.now();
    const firstFilename = `e2e-content-v1-${stamp}.pdf`;
    const secondFilename = `e2e-content-v2-${stamp}.pdf`;

    await test.step("a speaker uploads the same deliverable twice; both roles see numbered versions and one latest marker", async () => {
      const before = await apiData<DeliverableRow[]>(
        request,
        `${DELIVERABLES}?eventId=${encodeURIComponent(EVENT)}&taskId=${encodeURIComponent(TASKS.fileRequest.id)}&contactId=${encodeURIComponent(uploader.contactId)}`,
      );
      expect(before[0], "the seed assigns 'Upload your slides' to this speaker").toBeTruthy();
      const slotBefore = before[0] as DeliverableRow;
      slidesRequestId = slotBefore.fileRequestId;
      slidesSubmissionId = slotBefore.submissionId;
      const versionsBefore = slotBefore.versionCount;

      const speakerPage = await page.context().newPage();
      await loginAsSpeaker(speakerPage, EVENTS.main.slug, uploader.email);
      await speakerPage.goto(`/portal/${EVENTS.main.slug}/tasks`);
      await speakerPage.getByRole("link", { name: new RegExp(TASKS.fileRequest.name) }).first().click();

      for (const filename of [firstFilename, secondFilename]) {
        await speakerPage.locator('.file-upload input[type="file"]').setInputFiles({
          name: filename,
          mimeType: "application/pdf",
          buffer: Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n${filename}`),
        });
        await expect(speakerPage.locator(".portal-uploads")).toContainText(filename, { timeout: 60_000 });
      }
      // Exactly one row is ever marked latest, and it is the one just sent.
      const uploadRows = speakerPage.locator(".portal-uploads li");
      await expect(uploadRows.filter({ hasText: "Latest" })).toHaveCount(1);
      await expect(uploadRows.filter({ hasText: "Latest" })).toContainText(secondFilename);
      await speakerPage.close();

      const after = await apiData<FileVersion[]>(
        request,
        `${DELIVERABLES}/versions?eventId=${encodeURIComponent(EVENT)}&fileRequestId=${encodeURIComponent(slidesRequestId)}&contactId=${encodeURIComponent(uploader.contactId)}${slidesSubmissionId ? `&submissionId=${encodeURIComponent(slidesSubmissionId)}` : ""}`,
      );
      expect(after.length).toBe(versionsBefore + 2);
      const latest = after.find((version) => version.isLatest);
      expect(latest?.filename).toBe(secondFilename);
      expect(latest?.version).toBe(versionsBefore + 2);
      expect(after.filter((version) => version.isLatest)).toHaveLength(1);

      // The superseded version is still there and still authorized — nothing
      // is ever overwritten or deleted, per the module's own guardrail.
      const superseded = after.find((version) => version.filename === firstFilename);
      expect(superseded?.isLatest).toBe(false);
      const download = await page.request.get(`/api/uploads/${superseded?.fileAssetId}/download-url`);
      expect(download.ok()).toBeTruthy();
      expect(((await download.json()) as { data?: { url?: string } }).data?.url).toContain("http");

      // The organizer's own central Files view renders the same two versions
      // through its own server round trip, not a client fixture.
      await page.goto(FILES_PAGE);
      await page.getByPlaceholder("Search speaker, request, or session").fill(uploader.name);
      await page.getByRole("row", { name: new RegExp(uploader.name) }).first().click();
      const drawer = page.locator(".drawer");
      await expect(drawer.getByText(secondFilename)).toBeVisible();
      await expect(drawer.getByText(firstFilename)).toBeVisible();
      await expect(drawer.locator("em", { hasText: "Latest" })).toHaveCount(1);
    });

    await test.step("a speaker comment and an organizer reply land with correct author and timestamps, on both sides", async () => {
      const speakerNote = `Here is the latest deck ${stamp} — thoughts?`;
      const speakerPage = await page.context().newPage();
      await loginAsSpeaker(speakerPage, EVENTS.main.slug, uploader.email);
      await speakerPage.goto(`/portal/${EVENTS.main.slug}/tasks`);
      await speakerPage.getByRole("link", { name: new RegExp(TASKS.fileRequest.name) }).first().click();
      await speakerPage.getByPlaceholder("Add a comment for the organizers…").fill(speakerNote);
      await speakerPage.getByRole("button", { name: /send/i }).click();
      await expect(speakerPage.getByText(speakerNote)).toBeVisible();

      // Already visible in the organizer's Files drawer, still open from the
      // step above, with the speaker's own name attributed to it.
      await expect(page.getByText(speakerNote)).toBeVisible({ timeout: 15_000 });
      const organizerReply = `Thanks — approving version 2 ${stamp}`;
      await page.getByPlaceholder("Reply to the speaker…").fill(organizerReply);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText(organizerReply)).toBeVisible();

      const comments = await apiData<FileComment[]>(
        request,
        `${DELIVERABLES}/comments?eventId=${encodeURIComponent(EVENT)}&fileRequestId=${encodeURIComponent(slidesRequestId)}&contactId=${encodeURIComponent(uploader.contactId)}${slidesSubmissionId ? `&submissionId=${encodeURIComponent(slidesSubmissionId)}` : ""}`,
      );
      expect(comments.find((comment) => comment.body === speakerNote), "the speaker's own comment should be recorded").toBeTruthy();
      expect(comments.find((comment) => comment.body === organizerReply), "the organizer's reply should be recorded").toBeTruthy();
      const fromSpeaker = comments.find((comment) => comment.body === speakerNote) as FileComment;
      const fromOrganizer = comments.find((comment) => comment.body === organizerReply) as FileComment;
      expect(fromSpeaker.authorRole).toBe("speaker");
      expect(fromSpeaker.authorName).toContain(uploader.name.split(" ")[0]);
      expect(fromOrganizer.authorRole).toBe("organizer");
      expect(Date.parse(fromOrganizer.createdAt)).toBeGreaterThanOrEqual(Date.parse(fromSpeaker.createdAt));

      // The speaker's own view attributes the reply to "Organizer", never a
      // raw user id or email.
      await speakerPage.reload();
      await expect(speakerPage.getByText(organizerReply)).toBeVisible({ timeout: 15_000 });
      await expect(speakerPage.locator(".review-comment", { hasText: organizerReply }).getByText("Organizer")).toBeVisible();
      await speakerPage.close();
    });

    await test.step("the central Files view filters to one outstanding deliverable and a bulk reminder enqueues exactly one message", async () => {
      const open = await apiData<DeliverableRow[]>(request, `${DELIVERABLES}?eventId=${encodeURIComponent(EVENT)}&state=open`);
      const found = open.find((row) => row.contactId !== uploader.contactId);
      expect(found, "the seed has another outstanding deliverable besides the one this run just completed").toBeTruthy();
      const target = found as DeliverableRow;

      const before = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND contact_id = $2 AND task_id = $3 AND template_key = 'task_reminder'",
        [EVENT, target.contactId, target.taskId],
      );

      await page.goto(FILES_PAGE);
      const tab = page.locator(".abstract-status-tabs [role='tab']", { hasText: target.overdue ? "Overdue" : "Open" });
      await tab.click();
      await page.getByPlaceholder("Search speaker, request, or session").fill(target.contactName);
      const rowCheckbox = page.getByRole("checkbox", { name: `Select ${target.contactName}, ${target.fileRequestTitle}` });
      await expect(rowCheckbox).toHaveCount(1);
      await rowCheckbox.check();
      await page.getByRole("button", { name: /send reminder/i }).click();
      await expect(page.getByText(/Reminded 1 of 1/)).toBeVisible({ timeout: 15_000 });

      const after = await queryRows<{ n: string }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND contact_id = $2 AND task_id = $3 AND template_key = 'task_reminder'",
        [EVENT, target.contactId, target.taskId],
      );
      expect(Number(after[0]?.n ?? 0) - Number(before[0]?.n ?? 0)).toBe(1);
    });

    await test.step("editing a session twice builds attributed history; restoring the original and publishing shows it publicly without ever leaking the draft", async () => {
      const anchor = (await apiData<SessionRow[]>(request, `${AGENDA_SESSIONS}?eventId=${encodeURIComponent(EVENT)}`))
        .find((session) => session.id === SESSIONS.publishedKeynote.id);
      expect(anchor?.startsAt, "the seeded keynote anchors a real placed time").toBeTruthy();
      const anchorInstant = anchor?.startsAt ?? new Date().toISOString();
      const startsAt = new Date(Date.parse(anchorInstant) + 5 * 60 * 60 * 1000).toISOString();
      const endsAt = new Date(Date.parse(startsAt) + 30 * 60 * 1000).toISOString();
      const original = `E2E content history original ${stamp}`;
      const editOne = `E2E content history edit one ${stamp}`;
      const editTwo = `E2E content history edit two ${stamp}`;
      const creationId = crypto.randomUUID();

      const created = await apiData<SessionRow>(request, `${AGENDA_SESSIONS}?eventId=${encodeURIComponent(EVENT)}`, {
        method: "POST",
        data: {
          creationId,
          title: original, descriptionHtml: "<p>Original description</p>",
          roomId: VOCAB.rooms.studio, startsAt, endsAt, status: "draft",
        },
      });
      const sessionPath = `${AGENDA_SESSIONS}/${created.id}?eventId=${encodeURIComponent(EVENT)}`;
      const editedOne = await apiData<SessionRow>(request, sessionPath, {
        method: "PATCH",
        data: { id: created.id, title: editOne, descriptionHtml: "<p>Edit one</p>", roomId: VOCAB.rooms.studio, startsAt, endsAt, status: "draft", expectedVersion: created.rowVersion },
      });
      const editedTwo = await apiData<SessionRow>(request, sessionPath, {
        method: "PATCH",
        data: { id: created.id, title: editTwo, descriptionHtml: "<p>Edit two</p>", roomId: VOCAB.rooms.studio, startsAt, endsAt, status: "draft", expectedVersion: editedOne.rowVersion },
      });
      expect(editedTwo.title).toBe(editTwo);

      const history = await apiData<SessionHistory>(request, `${AGENDA_SESSIONS}/${created.id}/revisions?eventId=${encodeURIComponent(EVENT)}`);
      const revisions = history.content;
      expect(revisions.map((revision) => revision.title)).toEqual([editTwo, editOne, original]);
      expect(revisions.every((revision) => revision.editedByName)).toBe(true);
      // Three title/description edits that never touched the room or the time:
      // the placement half of the history must stay empty rather than fill up
      // with "moves" nobody made.
      expect(history.placements).toEqual([]);
      const originalRevision = revisions[2] as SessionRevision;

      // Still a draft: absent from the cache-busted public API.
      const leakCheck = await request.get(`/api/v1/events/${EVENTS.main.slug}/schedule?cb=${Date.now()}`);
      const leakTitles = ((await leakCheck.json()) as { data: PublicSession[] }).data.map((session) => session.title);
      expect(leakTitles).not.toContain(editTwo);

      const restored = await apiData<SessionRow>(request, `${AGENDA_SESSIONS}/${created.id}/revisions?eventId=${encodeURIComponent(EVENT)}`, {
        method: "POST",
        data: { revisionId: originalRevision.id },
      });
      expect(restored.title).toBe(original);
      expect(restored.status, "restoring content is never itself a publish").toBe("draft");

      const afterRestore = (await apiData<SessionHistory>(request, `${AGENDA_SESSIONS}/${created.id}/revisions?eventId=${encodeURIComponent(EVENT)}`)).content;
      expect(afterRestore[0]?.title).toBe(original);
      expect(afterRestore[0]?.restoredFromRevisionId).toBe(originalRevision.id);

      const published = await apiData<SessionRow>(request, sessionPath, {
        method: "PATCH",
        data: { id: created.id, title: original, descriptionHtml: "<p>Original description</p>", roomId: VOCAB.rooms.studio, startsAt, endsAt, status: "published", expectedVersion: restored.rowVersion },
      });
      expect(published.status).toBe("published");

      await expect(async () => {
        const response = await page.request.get(`/api/v1/events/${EVENTS.main.slug}/schedule?cb=${Date.now()}`);
        const titles = ((await response.json()) as { data: PublicSession[] }).data.map((session) => session.title);
        expect(titles).toContain(original);
        expect(titles).not.toContain(editTwo);
      }).toPass({ timeout: 30_000, intervals: [2_000] });

      await page.goto(`/e/${EVENTS.main.slug}/schedule`);
      const tabs = page.locator(".public-day-tabs button");
      let visible = false;
      for (let index = 0; index < await tabs.count(); index += 1) {
        await tabs.nth(index).click();
        if (await page.getByText(original).count() > 0) { visible = true; break; }
      }
      expect(visible, "the restored, published title should render on the public schedule").toBe(true);
      await expect(page.getByText(editTwo)).toHaveCount(0);
    });

    await test.step("an organizer edits a speaker's bio and headshot through the existing contact/file paths", async () => {
      const detail = await apiData<{ contact: { contactId: string; name: string } }>(request, `${SPEAKERS}`, {
        method: "POST",
        data: { email: uniqueEmail("content-bio"), firstName: "Blaise", lastName: "Contentful" },
      });
      const bioText = `Speaks about distributed systems and coffee ${stamp}.`;

      await apiData(request, `${SPEAKERS}/${detail.contact.contactId}`, { method: "PATCH", data: { bioHtml: `<p>${bioText}</p>` } });

      await page.goto(`/events/${EVENT}/speakers/${detail.contact.contactId}`);
      await expect(page.getByText(bioText)).toBeVisible();

      const headshotFilename = `e2e-headshot-${stamp}.png`;
      await page.locator('.file-upload input[type="file"]').setInputFiles({
        name: headshotFilename,
        mimeType: "image/png",
        buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
      });
      await expect(page.getByText("Photo updated")).toBeVisible({ timeout: 30_000 });

      const savedDetail = await apiData<{ contact: { headshotFileId: string | null } }>(request, `${SPEAKERS}/${detail.contact.contactId}`);
      expect(savedDetail.contact.headshotFileId).toBeTruthy();

      const currentUpload = page.locator(".file-upload__done");
      await expect(currentUpload).toContainText(headshotFilename);
      const picker = page.waitForEvent("filechooser");
      await currentUpload.getByRole("button", { name: "Replace", exact: true }).click();
      await (await picker).setFiles([]);
      await expect(currentUpload, "cancelling Replace must retain the file that will still submit").toContainText(headshotFilename);

      const persistedDetail = await apiData<{ contact: Record<string, unknown>; [key: string]: unknown }>(request, `${SPEAKERS}/${detail.contact.contactId}`);
      const firstCandidateId = "00000000-0000-4000-8000-0000000000a1";
      const staleCandidateId = "00000000-0000-4000-8000-0000000000a2";
      let candidateId = firstCandidateId;
      let failPresign = false;
      let failNextSave = true;
      let presignCalls = 0;
      let saveCalls = 0;

      await page.route("**/api/uploads/presign", async (route) => {
        presignCalls += 1;
        if (failPresign) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Replacement upload failed" } }) });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { fileId: candidateId, uploadUrl: `${new URL(page.url()).origin}/__e2e-upload/${candidateId}`, requiredHeaders: {} } }),
        });
      });
      await page.route("**/__e2e-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
      await page.route("**/api/uploads/finalize", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { status: "ready" } }),
      }));
      await page.route(`**${SPEAKERS}/${detail.contact.contactId}`, async (route) => {
        if (route.request().method() !== "PATCH") {
          await route.continue();
          return;
        }
        saveCalls += 1;
        if (failNextSave) {
          failNextSave = false;
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Replacement could not be saved" } }) });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { ...persistedDetail, contact: { ...persistedDetail.contact, headshotFileId: candidateId } } }),
        });
      });

      const firstCandidateName = `e2e-headshot-replacement-${stamp}.png`;
      await page.locator('.file-upload input[type="file"]').setInputFiles({
        name: firstCandidateName,
        mimeType: "image/png",
        buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
      });
      await expect(page.getByRole("alert")).toContainText("could not be saved");
      await expect(currentUpload, "a failed save must leave the authoritative file visible").toContainText(headshotFilename);
      await page.getByRole("button", { name: "Try saving again", exact: true }).click();
      await expect(currentUpload).toContainText(firstCandidateName);
      expect(presignCalls, "retrying association must not upload the same bytes again").toBe(1);
      expect(saveCalls).toBe(2);

      candidateId = staleCandidateId;
      failNextSave = true;
      await page.locator('.file-upload input[type="file"]').setInputFiles({
        name: `e2e-headshot-stale-${stamp}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
      });
      await expect(page.getByRole("button", { name: "Try saving again", exact: true })).toBeVisible();
      const anotherPicker = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Choose another file", exact: true }).click();
      await (await anotherPicker).setFiles([]);
      await expect(page.getByRole("button", { name: "Try saving again", exact: true }), "cancelling another pick must retain the uploaded candidate's save retry").toBeVisible();
      const savesBeforeAbandoning = saveCalls;
      failPresign = true;
      await page.locator('.file-upload input[type="file"]').setInputFiles({
        name: `e2e-headshot-failed-${stamp}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
      });
      await expect(page.getByRole("alert")).toContainText("Replacement upload failed");
      await expect(currentUpload).toContainText(firstCandidateName);
      await expect(page.getByRole("button", { name: "Try saving again", exact: true })).toHaveCount(0);
      expect(saveCalls, "a new upload attempt must discard the stale association retry").toBe(savesBeforeAbandoning);

      await page.unroute("**/api/uploads/presign");
      await page.unroute("**/__e2e-upload/**");
      await page.unroute("**/api/uploads/finalize");
      await page.unroute(`**${SPEAKERS}/${detail.contact.contactId}`);
    });

    await test.step("a grouped ZIP export contains only the selected deliverable's latest file, and nothing unselected", async () => {
      const withFiles = await apiData<DeliverableRow[]>(request, `${DELIVERABLES}?eventId=${encodeURIComponent(EVENT)}&hasUpload=true`);
      const foundSelected = withFiles.find((row) => row.contactId === uploader.contactId && row.fileRequestId === slidesRequestId);
      const foundExcluded = withFiles.find((row) => row.contactId !== uploader.contactId);
      expect(foundSelected, "the deliverable this run just uploaded should have a file").toBeTruthy();
      expect(foundExcluded, "the seed has at least one other deliverable with a file, to prove it is excluded").toBeTruthy();
      const selected = foundSelected as DeliverableRow;
      const excluded = foundExcluded as DeliverableRow;

      const job = await apiData<ExportJob>(request, `${DELIVERABLES}/export?eventId=${encodeURIComponent(EVENT)}`, {
        method: "POST",
        data: {
          groupBy: "speaker",
          targets: [{ taskId: selected.taskId, contactId: selected.contactId, submissionId: selected.submissionId }],
        },
      });
      const settled = await settleExportJob(request, job.id);
      expect(settled.status, settled.error ?? "export failed").toBe("completed");
      expect(settled.entryCount).toBe(1);
      expect(settled.resultFileId).toBeTruthy();

      const download = await request.get(`/api/uploads/${settled.resultFileId}/download-url`);
      const zipUrl = ((await download.json()) as { data?: { url?: string } }).data?.url;
      expect(zipUrl, "the export job's result should be a downloadable presigned URL").toBeTruthy();
      const zipResponse = await request.get(zipUrl ?? "");
      expect(zipResponse.ok()).toBeTruthy();
      const names = readStoredZipNames(await zipResponse.body());

      expect(names).toHaveLength(1);
      // Grouped by speaker: the archive path carries the uploader's name as a folder.
      expect(names[0]).toContain("/");
      expect(names[0]?.endsWith(secondFilename)).toBe(true);
      expect(names.some((name) => name.includes(excluded.latestVersion?.filename ?? "\0"))).toBe(false);
    });

    assertClean();
  });

  test.describe("without a database the assertions above cannot be made", () => {
    test.skip(databaseConfigured(), NO_DATABASE);
    test("is skipped", () => { expect(databaseConfigured()).toBe(false); });
  });
});
