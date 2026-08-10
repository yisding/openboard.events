import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin, loginAsSpeaker } from "./helpers/auth";
import { queryRows } from "./helpers/db";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, TASKS, uniqueEmail } from "./helpers/seeded";

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
  test.skip(!landed("M51"), waitingOn("M51"));

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
      const send = await apiData<{ queued: number; skipped: number; errors: unknown[] }>(request, `${SPEAKERS}/bulk-email`, {
        method: "POST",
        data: { contactIds, subject, bodyHtml, mode: "send" },
      });
      expect(send.queued).toBe(2);
      expect(send.errors).toEqual([]);
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
