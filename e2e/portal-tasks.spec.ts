import { test } from "@playwright/test";
import { expectNoConsoleErrors } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";

/**
 * Goes green when M21 (portal shell), M22 (profile) and M25 (task runtime) land
 * — target CP3, owned by WS-D.
 */
test.describe("portal-tasks", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("the profile", () => {
    test.skip(!landed("M21", "M22"), waitingOn("M21", "M22"));

    test("a speaker signs in and saves a profile", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await test.step("sign in through the normal OTP challenge", async () => {});
      await test.step("the bio counter reads 5,000 and the server refuses more", async () => {
        // Both halves matter: a client-only limit is not a limit.
      });
      assertClean();
    });
  });

  test.describe("task completion", () => {
    test.skip(!landed("M21", "M25"), waitingOn("M21", "M25"));

    test("a speaker completes a manual task and a file-request task", async () => {
      await test.step("complete the manual task", async () => {});
      await test.step("upload a small fixture to the file-request task", async () => {
        // Exercises M07's presign → PUT → finalize path from a browser, which is
        // the only place CORS is actually proven.
      });
      await test.step("the dashboard outstanding count drops on the next poll", async () => {});
    });
  });
});

/** M25's AC: portal login through file-task completion at phone width. */
test.describe("portal-tasks on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(!targetConfigured(), NO_TARGET);
  test.skip(!landed("M21", "M25"), waitingOn("M21", "M25"));

  test("login and file completion work at 390px", async () => {
    await test.step("the task list and the upload control are usable at 390px", async () => {});
  });
});
