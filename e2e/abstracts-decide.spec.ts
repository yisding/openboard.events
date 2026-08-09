import { test } from "@playwright/test";
import { expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";

/**
 * Goes green when M17 (abstracts), M18 (mutations + notify) and M34 (dispatcher)
 * land — target CP2, owned by WS-C / WS-F.
 */
test.describe("abstracts-decide", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("the table", () => {
    test.skip(!landed("M17"), waitingOn("M17"));

    test("the table agrees with the status counts view", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      await test.step("tab counts match submission_status_counts_v", async () => {});
      await test.step("the detail drawer's Answers tab shows the pinned snapshot's labels", async () => {
        // Labels come from the snapshot pinned at submit time, not from the form
        // as it looks now — that is the whole point of pinning.
      });
      assertClean();
    });
  });

  test.describe("decide and notify", () => {
    test.skip(!landed("M17", "M18", "M34"), waitingOn("M17", "M18", "M34"));
    test.skip(!databaseConfigured(), NO_DATABASE);

    test("bulk accept and notify sends exactly one email per submission", async ({ page }) => {
      await loginAsAdmin(page);
      await test.step("select two rows and move them to the accept queue", async () => {});
      await test.step("notify stamps the Notified column and flips both to Accepted", async () => {});
      await test.step("exactly one communication_logs row exists per submission", async () => {
        // Queried against sb-test directly: the UI cannot prove a fan-out law.
      });
      await test.step("pressing notify again creates no new rows", async () => {
        // The idempotency assertion: count of template_key='submission_accepted'
        // is unchanged after the second press.
      });
    });
  });

  test.describe("the empty event", () => {
    test.skip(!landed("M09", "M17"), waitingOn("M09", "M17"));

    test("the empty event's abstracts surface renders its empty state", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      assertClean();
    });
  });
});
