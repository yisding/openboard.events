import { expect, test } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { countRows, queryRows } from "./helpers/db";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { EVENTS } from "./helpers/seeded";

/** Abstract review, bulk decisions, and notification journeys. */

const ABSTRACTS = `/events/${EVENTS.main.id}/abstracts`;
const API = `/api/internal/submissions/${EVENTS.main.id}`;

/** The two seeded pending rows this spec decides on, addressed by their seeded titles. */
const TO_ACCEPT = ["Observability for prompt pipelines", "Scaling human review"] as const;

type ListRow = { submissionId: string; title: string; status: string; code: number };

test.describe("abstracts-decide", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("the table", () => {
    test.skip(!databaseConfigured(), NO_DATABASE);

    test("the table agrees with the status counts view", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      await page.goto(ABSTRACTS);

      await test.step("filter counts match submission_status_counts_v", async () => {
        // The view is the contract (M03), the filters are the claim. Reading both
        // and comparing is the only way to catch the class of bug where a join
        // doubles a count — #37 was exactly that.
        const rows = await queryRows<{ status: string; n: number }>(
          "SELECT status, n FROM submission_status_counts_v WHERE event_id = $1",
          [EVENTS.main.id],
        );
        const expected = new Map(rows.map((row) => [row.status, Number(row.n)]));
        const total = [...expected.values()].reduce((sum, n) => sum + n, 0);
        expect(total, "the seeded event must have submissions to count").toBeGreaterThan(0);

        const filters = page.getByRole("group", { name: "Filter abstracts by workflow" });
        const labelled = async (label: string) => {
          const button = filters.getByRole("button", { name: new RegExp(`^${label}\\b`) });
          return Number(await button.locator('[aria-hidden="true"]').first().innerText());
        };
        const pending = expected.get("pending") ?? 0;
        const acceptQueue = expected.get("accept_queue") ?? 0;
        const declineQueue = expected.get("decline_queue") ?? 0;
        const ready = acceptQueue + declineQueue;
        const decided = (expected.get("accepted") ?? 0) + (expected.get("declined") ?? 0) + (expected.get("withdrawn") ?? 0);
        expect(await labelled("All")).toBe(total);
        expect(await labelled("Needs decision")).toBe(pending);
        expect(await labelled("Ready to notify")).toBe(ready);
        expect(await labelled("Decided")).toBe(decided);
        await expect(filters.getByRole("button", { name: /^Ready to notify\b/ })).toHaveAccessibleName(
          `Ready to notify, ${ready} ${ready === 1 ? "abstract" : "abstracts"}, ${acceptQueue} accept, ${declineQueue} decline`,
        );
      });

      await test.step("the detail drawer's Answers tab shows the pinned snapshot's labels", async () => {
        // Labels come from the snapshot pinned at submit time, not from the form
        // as it looks now — that is the whole point of pinning.
        const title = TO_ACCEPT[0];
        await page.goto(`${ABSTRACTS}?status=all&search=${encodeURIComponent(title)}`);
        await page.getByRole("row", { name: new RegExp(title.slice(0, 24)) }).first().click();
        const drawer = page.locator(".submission-drawer");
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole("heading", { name: "Answers" })).toBeVisible();
        // The version the speaker answered against, stated on the panel.
        await expect(drawer.getByText(/rendered against form version 1/i)).toBeVisible();
        // Seeded answers are written for the form-A snapshot's own fields, so
        // its labels are what must appear here. Scoped to the rendered snapshot
        // (`.form-render`): the editable Details section above it has labels of
        // its own, and matching those would prove nothing about pinning.
        const answers = drawer.locator(".form-render").first();
        await expect(answers.getByText("Title", { exact: true })).toBeVisible();
        await expect(answers.getByText("Track", { exact: true })).toBeVisible();
      });

      assertClean();
    });
  });

  test.describe("decide and notify", () => {
    test.skip(!databaseConfigured(), NO_DATABASE);

    test("bulk accept and notify sends exactly one email per submission", async ({ page }) => {
      await loginAsAdmin(page);

      const statusOf = async (title: string): Promise<string> => {
        const list = await apiData<{ rows: ListRow[] }>(page.request, `${API}?status=all&search=${encodeURIComponent(title)}`);
        return list.rows[0]?.status ?? "";
      };

      await test.step("select two rows and move them to the accept queue", async () => {
        for (const title of TO_ACCEPT) {
          // Retry-safe: this test mutates seeded rows, and an attempt that
          // moved a row before failing further down leaves nothing on the
          // Pending tab for the retry to select — which reports "the checkbox
          // did not change its state" instead of the original failure.
          if (await statusOf(title) === "accept_queue") continue;
          await page.goto(`${ABSTRACTS}?status=pending&search=${encodeURIComponent(title)}`);
          // One row matches the search, so "select every row on this page" is a
          // precise selection rather than a blunt one.
          await page.getByRole("checkbox", { name: "Select every row on this page" }).check();
          await page.getByRole("button", { name: /move to accept queue/i }).click();
          await expect.poll(
            () => statusOf(title),
            { message: `${title} should be in the accept queue`, timeout: 20_000 },
          ).toBe("accept_queue");
        }
      });

      // Notify is event-wide: it finalizes every queued decision, not only the
      // two rows just moved. The seeded queues are part of the batch by design.
      const queued = await apiData<{ rows: ListRow[] }>(page.request, `${API}?status=accept_queue&pageSize=200`);
      const queuedIds = queued.rows.map((row) => row.submissionId);
      expect(queuedIds.length, "the two moved rows plus the seeded queue").toBeGreaterThanOrEqual(TO_ACCEPT.length);

      await test.step("notify stamps the Notified column and flips both to Accepted", async () => {
        await page.goto(`${ABSTRACTS}?status=accept_queue`);
        await page.getByRole("button", { name: /^send \d+ decision emails?$/i }).click();
        await page.getByRole("button", { name: /queue decision emails/i }).click();

        for (const title of TO_ACCEPT) {
          await expect.poll(
            () => statusOf(title),
            { message: `${title} should be accepted`, timeout: 30_000 },
          ).toBe("accepted");
        }

        // "Notified" is a column in the work order and a timestamp in the
        // schema; the merged table does not render it, so the stamp is asserted
        // where it actually lives. `notified_at IS NULL` is what makes a second
        // Notify a no-op, so this is the load-bearing half either way.
        const notStamped = await countRows(
          "SELECT count(*)::int AS n FROM submissions WHERE event_id = $1 AND id = ANY($2::uuid[]) AND notified_at IS NULL",
          [EVENTS.main.id, queuedIds],
        );
        expect(notStamped, "every notified submission carries notified_at").toBe(0);
      });

      await test.step("exactly one communication_logs row exists per submission", async () => {
        // Queried against sb-test directly: the UI cannot prove a fan-out law.
        // One row per submission, not per participant — a co-speaker learns
        // through the portal, and mailing everyone turns one decision into four
        // emails nobody asked for.
        const perSubmission = await queryRows<{ submission_id: string; n: number }>(
          `SELECT submission_id, count(*)::int AS n FROM communication_logs
           WHERE event_id = $1 AND template_key = 'submission_accepted' AND submission_id = ANY($2::uuid[])
           GROUP BY submission_id`,
          [EVENTS.main.id, queuedIds],
        );
        expect(perSubmission.map((row) => row.submission_id).sort()).toEqual([...queuedIds].sort());
        for (const row of perSubmission) {
          expect(Number(row.n), `submission ${row.submission_id} should have exactly one accepted email`).toBe(1);
        }
      });

      await test.step("pressing notify again creates no new rows", async () => {
        // The idempotency assertion: count of template_key='submission_accepted'
        // is unchanged after the second press.
        //
        // Through the route rather than the button: once the queues are empty
        // the bar hides the button (there is nothing left to notify), and the
        // property under test belongs to `notifyQueues`, not to the bar.
        const before = await countRows(
          "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND template_key = 'submission_accepted'",
          [EVENTS.main.id],
        );
        const second = await page.request.post(`${API}/notify`, { data: {} });
        expect(second.status(), "a second notify is a successful no-op, not an error").toBe(200);
        const payload = await second.json() as { data: { accepted: string[]; declined: string[]; emailsQueued: number } };
        expect(payload.data.accepted, "nothing is left to decide").toEqual([]);
        expect(payload.data.emailsQueued).toBe(0);

        const after = await countRows(
          "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND template_key = 'submission_accepted'",
          [EVENTS.main.id],
        );
        expect(after, "a second Notify must not mail anybody twice").toBe(before);
      });
    });
  });

  test.describe("the empty event", () => {
    test("the empty event's abstracts surface renders its empty state", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      // An empty surface that crashes is a judged failure, and this is the
      // cheapest place to catch it.
      await page.goto(`/events/${EVENTS.empty.id}/abstracts`);
      // `exact`, because the empty state's own <h3> ("No abstracts yet") is
      // also a heading whose accessible name contains "abstracts" — an
      // inexact name matches both and fails strict mode on a healthy page.
      await expect(page.getByRole("heading", { name: "Abstracts", exact: true })).toBeVisible();
      await expect(page.getByText("No abstracts yet")).toBeVisible();
      await expect(page.getByText(/submissions appear here as speakers complete/i)).toBeVisible();
      assertClean();
    });
  });
});
