import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { queryRows } from "./helpers/db";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { EVENTS, uniqueEmail } from "./helpers/seeded";

/**
 * Communications — the outbox and the Delivery log, against the deployed
 * preview.
 *
 * `src/features/comms` is the largest feature in the repo and the only one an
 * organizer is asked to *trust*, yet the outbox was previously only ever an
 * assertion target inside other specs ("two rows appeared") and the words
 * "Delivery log" appeared in no spec at all. The point of running this against
 * a deployed target rather than PGlite is the half PGlite structurally cannot
 * see:
 *
 *  - a queued row is actually *drained* by the deployed `%1` outbox cron, and
 *    reaches a terminal state that states its own outcome — a provider message
 *    id when it sent, a specific named reason when it did not;
 *  - the same send replayed with the same `sendId` adds no second row to a
 *    real database, not merely to a fixture;
 *  - the Delivery log an organizer reads renders those rows, filters them, and
 *    opens one message's audit detail — the surface where "did Speaker X get
 *    their acceptance email?" is answered;
 *  - an unsubscribed contact is counted out of the audience *preview* and
 *    again at send time, and never gains an outbox row.
 */

const EVENT = EVENTS.main.id;
const COMMS = `/api/internal/comms/${EVENT}`;
const SPEAKERS = `/api/internal/speakers/${EVENT}`;
const COMMUNICATIONS = `/events/${EVENT}/communications`;

/** How long the deployed `%1` cron is given to claim and settle one row. */
const DRAIN_BUDGET_MS = 180_000;

type CommLogRow = {
  id: string;
  contactId: string | null;
  recipientEmail: string;
  recipientName: string;
  templateKey: string;
  status: "queued" | "sent" | "failed" | "skipped" | "bounced" | "complained";
  subjectRendered: string | null;
  providerMessageId: string | null;
  error: string | null;
};
type CommLogDetail = CommLogRow & { bodyRenderedHtml: string | null; idempotencyKey: string; attempts: number };
type BulkResult = { queued: number; alreadyQueued: number; skipped: number; errors: Array<{ contactId: string; reason: string }> };
type ResolvedSegment = {
  matchedCount: number;
  contactIds: string[];
  excludedSuppressedCount: number;
  excludedUnsubscribedCount: number;
};
type SpeakerDetail = { contact: { contactId: string; name: string; email: string } };
type SuppressionRow = { contactId: string; email: string; name: string; reason: "bounce" | "complaint" };
type DeliverabilityRow = { domain: string; sent: number; bounced: number; complained: number; failed: number };

const logFor = (request: APIRequestContext, contactId: string): Promise<CommLogRow[]> =>
  apiData<CommLogRow[]>(request, `${COMMS}/log?contactId=${encodeURIComponent(contactId)}`);

/**
 * Waits for the deployed cron to take one queued row to a terminal state.
 *
 * `queued` is the only non-terminal status: `sent`, `skipped` and `failed` are
 * all outcomes the organizer is entitled to read, and which one it is depends
 * on the target's mail configuration (an `EMAIL_ALLOWLIST` on preview skips
 * every address it does not name). The wait is the assertion — a target whose
 * outbox cron is not running never leaves `queued`.
 */
async function settledRow(request: APIRequestContext, logId: string): Promise<CommLogDetail> {
  const read = (): Promise<CommLogDetail> => apiData<CommLogDetail>(request, `${COMMS}/log/${logId}`);
  await expect
    .poll(async () => (await read()).status, {
      message: "the deployed outbox cron should claim and settle a queued message",
      timeout: DRAIN_BUDGET_MS,
      // The cron ticks once a minute; polling faster than that only spends the
      // target's request budget on an answer that cannot have changed.
      intervals: [1_000, 5_000, 10_000],
    })
    .not.toEqual("queued");
  return read();
}

/** The Delivery log tab, addressed the way the tablist actually exposes it. */
async function openCommsTab(page: Page, label: string): Promise<void> {
  await page.goto(COMMUNICATIONS);
  await page.getByRole("tab", { name: label }).click();
}

test.describe("comms-outbox", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  // One long round trip through a real outbox: the cron tick alone is allowed
  // three minutes, which Playwright's 30 s default expires inside.
  test.beforeEach(({}, testInfo) => { testInfo.setTimeout(300_000); });

  test("a bulk send writes one outbox row, replays without duplicating it, and the cron settles it with a stated outcome", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    const email = uniqueEmail("outbox");
    const created = await apiData<SpeakerDetail>(request, SPEAKERS, {
      method: "POST",
      data: { email, firstName: "Outbox", lastName: "Probe" },
    });
    const contactId = created.contact.contactId;
    const subject = `E2E outbox ${Date.now()}`;
    const sendId = crypto.randomUUID();
    const message = { contactIds: [contactId], subject, bodyHtml: "<p>Hello {{speaker.first_name}}.</p>" };
    let logId = "";

    await test.step("the send is accounted for, and the outbox holds exactly one row for it", async () => {
      const sent = await apiData<BulkResult>(request, `${SPEAKERS}/bulk-email`, {
        method: "POST",
        data: { ...message, mode: "send", sendId },
      });
      expect(sent).toMatchObject({ queued: 1, alreadyQueued: 0, skipped: 0, errors: [] });

      const rows = await logFor(request, contactId);
      expect(rows, "one recipient, one outbox row").toHaveLength(1);
      const row = rows[0] as CommLogRow;
      expect(row.templateKey).toBe("speaker_bulk_message");
      expect(row.recipientEmail).toBe(email);
      logId = row.id;
    });

    await test.step("replaying the same send id recovers rather than re-queues", async () => {
      // The idempotency key is derived from `sendId`, so a lost response is
      // safe to retry — the recovery path `BulkSendTab` drives on every
      // unconfirmed send. What makes this worth asserting against a real
      // database is that the *outbox* is unchanged, not just the reply.
      const replay = await apiData<BulkResult>(request, `${SPEAKERS}/bulk-email`, {
        method: "POST",
        data: { ...message, mode: "send", sendId },
      });
      expect(replay).toMatchObject({ queued: 0, alreadyQueued: 1, errors: [] });
      expect(await logFor(request, contactId)).toHaveLength(1);
    });

    await test.step("the deployed cron drains it, and the row says what became of it", async () => {
      const settled = await settledRow(request, logId);
      expect(settled.attempts, "a claimed row counts its attempt").toBeGreaterThanOrEqual(1);
      expect(settled.idempotencyKey).toContain(sendId);

      if (settled.status === "sent") {
        expect(settled.providerMessageId, "a sent row carries the provider's id").toBeTruthy();
        expect(settled.subjectRendered).toBe(subject);
      } else {
        // Not sending is a legitimate outcome — a target with an
        // `EMAIL_ALLOWLIST` skips every address it does not name. What is not
        // legitimate is an outcome the organizer cannot read: the row must
        // name its own reason rather than fail generically.
        expect(settled.status, "a settled row is sent or deliberately skipped, never failed").toBe("skipped");
        expect(settled.error ?? "", "a skipped row explains itself").not.toEqual("");
        expect(settled.error ?? "").not.toMatch(/^(error|failed|something went wrong)\.?$/i);
      }
    });

    await test.step("the Delivery log shows this message, and its detail is a full audit record", async () => {
      await openCommsTab(page, "Delivery log");
      await page.getByRole("textbox", { name: "Search recipients" }).fill(email);
      const row = page.getByRole("row", { name: new RegExp(email.replace(/[.+]/g, "\\$&")) });
      await expect(row).toHaveCount(1);
      await row.click();

      const sheet = page.getByRole("dialog", { name: "Message detail" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(email);
      await expect(sheet).toContainText("Idempotency key");
      // The idempotency key is the field that makes the log an audit record
      // rather than a feed: it is what proves this message was sent once.
      await expect(sheet).toContainText(sendId);
    });

    assertClean();
  });

  test("an unsubscribed contact leaves the audience preview, is skipped at send time, and never reaches the outbox", async ({ page, request }) => {
    test.skip(!databaseConfigured(), NO_DATABASE);
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    const email = uniqueEmail("unsub");
    const created = await apiData<SpeakerDetail>(request, SPEAKERS, {
      method: "POST",
      data: { email, firstName: "Unsub", lastName: "Probe" },
    });
    const contactId = created.contact.contactId;
    const resolve = (): Promise<ResolvedSegment> =>
      apiData<ResolvedSegment>(request, `${COMMS}/bulk-email/segment`, { method: "POST", data: {} });

    const before = await resolve();
    expect(before.contactIds, "a new speaker is in the unfiltered audience to begin with").toContain(contactId);

    // The state an honored `List-Unsubscribe` link produces. It is arranged
    // directly rather than clicked because the signed token that produces it
    // is minted only *inside* a rendered send, and a target that skips before
    // rendering (an `EMAIL_ALLOWLIST`, the demo-event guard) never mints one —
    // so driving the link would make this assertion depend on the target's
    // mail configuration rather than on the product. Everything asserted below
    // is the product's own behaviour, in all three places it owes it.
    await queryRows("UPDATE contacts SET unsubscribed_at = now() WHERE id = $1 AND event_id = $2", [contactId, EVENT]);

    await test.step("the audience an organizer approves counts them out", async () => {
      const after = await resolve();
      expect(after.excludedUnsubscribedCount).toBe(before.excludedUnsubscribedCount + 1);
      expect(after.contactIds).not.toContain(contactId);
    });

    await test.step("and the send-time recheck, which is the authority, refuses them", async () => {
      const blocked = await apiData<BulkResult>(request, `${SPEAKERS}/bulk-email`, {
        method: "POST",
        data: {
          contactIds: [contactId],
          subject: `E2E unsubscribed ${Date.now()}`,
          bodyHtml: "<p>This one must not be queued.</p>",
          mode: "send",
          sendId: crypto.randomUUID(),
        },
      });
      expect(blocked).toMatchObject({ queued: 0, skipped: 1 });
      expect(await logFor(request, contactId), "a skipped recipient never reaches the outbox").toHaveLength(0);
    });

    await test.step("the organizer is told why nothing is reaching this speaker", async () => {
      await page.goto(`/events/${EVENT}/speakers/${contactId}`);
      await expect(page.getByText("This speaker unsubscribed from event communications.")).toBeVisible();
    });

    assertClean();
  });

  test("the Delivery log filters, and says so when a filter matches nothing", async ({ page }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(page);

    await openCommsTab(page, "Delivery log");
    const table = page.locator(".communications-panel table");
    await expect(table.locator("tbody tr").first()).toBeVisible();

    await test.step("a template filter narrows the log to one kind of message", async () => {
      await page.getByRole("combobox", { name: "Filter by template" }).selectOption("submission_received");
      // Every visible row is the template that was picked — a filter that
      // narrows to "mostly" the right rows is not a filter. Polling the whole
      // distinct set, rather than reading it once, also waits out the refetch
      // the filter change triggers.
      await expect
        .poll(async () => [...new Set((await table.locator("tbody tr .track-chip").allInnerTexts()).map((label) => label.trim()))], {
          message: "the template filter should leave only Submission received rows",
        })
        .toEqual(["Submission received"]);
      await page.getByRole("combobox", { name: "Filter by template" }).selectOption("");
    });

    await test.step("an empty result is a filter state with a way back, not a dead end", async () => {
      await page.getByRole("textbox", { name: "Search recipients" }).fill("nobody-by-this-name-exists");
      await expect(page.getByText("Nothing matches these filters")).toBeVisible();
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(table.locator("tbody tr").first()).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Search recipients" })).toHaveValue("");
    });

    assertClean();
  });

  test("Suppressions and Deliverability report the event's sending health", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    await test.step("the suppression list reflects the provider, and nothing else", async () => {
      // There is deliberately no "add a suppression" control: the table only
      // ever shows what Resend actually reported, so on an event that has
      // never bounced the honest state is a described empty one.
      const suppressions = await apiData<SuppressionRow[]>(request, `${COMMS}/suppressions`);
      await openCommsTab(page, "Suppressions");
      if (suppressions.length === 0) {
        await expect(page.getByText("No suppressed addresses")).toBeVisible();
        await expect(page.getByText(/hard bounce or spam complaint/i)).toBeVisible();
      } else {
        await expect(page.getByText(suppressions[0]?.email ?? "")).toBeVisible();
      }
    });

    await test.step("deliverability rolls the same log up per sending domain", async () => {
      const domains = await apiData<DeliverabilityRow[]>(request, `${COMMS}/deliverability`);
      await openCommsTab(page, "Deliverability");
      const tiles = page.locator(".communications-panel .stat-tile");
      await expect(tiles.filter({ hasText: "Domains" })).toContainText(String(domains.length));
      for (const domain of domains.slice(0, 3)) {
        await expect(page.getByRole("cell", { name: domain.domain, exact: true })).toBeVisible();
      }
    });

    assertClean();
  });

  test("an unsubscribe link that cannot be verified offers nothing to click", async ({ page }) => {
    const assertClean = expectNoConsoleErrors(page);
    // A tampered or expired token must not reveal whether the contact exists,
    // and must not render a form that would appear to do something.
    await page.goto(`/portal/${EVENTS.main.slug}/unsubscribe?token=not-a-real-token`);
    await expect(page.getByRole("heading", { name: "This unsubscribe link is invalid" })).toBeVisible();
    await expect(page.getByRole("button", { name: /unsubscribe/i })).toHaveCount(0);
    assertClean();
  });

  test.describe("without a database the unsubscribe assertions above cannot be made", () => {
    test.skip(databaseConfigured(), NO_DATABASE);
    test("is skipped", () => { expect(databaseConfigured()).toBe(false); });
  });
});
