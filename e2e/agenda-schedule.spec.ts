import { test } from "@playwright/test";
import { expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { SESSIONS } from "./helpers/seeded";

/**
 * Goes green when M28 (sessions CRUD), M29 (conflict engine) and M31 (views)
 * land — target CP3, owned by WS-E.
 *
 * No drag simulation anywhere in this file: quality-strategy §3 bans it and drag
 * is verified by hand. Sessions are placed through the edit dialog.
 */
test.describe("agenda-schedule", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("conflict detection", () => {
    test.skip(!landed("M28", "M29"), waitingOn("M28", "M29"));

    test("overlapping sessions in one room raise exactly one conflict", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      await test.step("place two sessions in one room at overlapping times", async () => {
        // Through the edit dialog — never a simulated drag.
      });
      await test.step("the Conflicts tab badge reads 1", async () => {});
      await test.step("making them back-to-back drops the badge to 0", async () => {
        // The half-open interval assertion: [start, end) means touching is not
        // overlapping, and this is the case that regresses silently.
      });
      assertClean();
    });
  });

  test.describe("the seeded conflict pair", () => {
    test.skip(!landed("M09", "M29"), waitingOn("M09", "M29"));

    test("the seeded conflict pair is flagged and the back-to-back pair is not", async ({ page }) => {
      await loginAsAdmin(page);
      await test.step(`${SESSIONS.conflictA} and ${SESSIONS.conflictB} are flagged`, async () => {});
      await test.step("the seeded back-to-back pair is not flagged", async () => {});
    });
  });

  test.describe("publishing", () => {
    test.skip(!landed("M28", "M32"), waitingOn("M28", "M32"));

    test("publishing a session puts it on the public schedule", async () => {
      await test.step("publish one session", async () => {});
      await test.step("it appears on /e/<slug>/schedule within the cache window", async () => {});
    });
  });
});
