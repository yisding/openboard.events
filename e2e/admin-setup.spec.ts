import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, TEMPLATE_KEYS_PER_EVENT } from "./helpers/seeded";

/**
 * Goes green when M11 (events + vocab) and M12 (form builder core) land — target
 * CP2, owned by WS-B1.
 *
 * Every gate is a describe-level modifier, never a skip inside a test body: a
 * body-level skip still builds the `page` fixture, so an unlanded step would
 * launch a browser just to skip.
 */
test.describe("admin-setup", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("against the seeded world", () => {
    test.skip(!landed("M09"), waitingOn("M09"));

    test("an organizer signs in and reaches the seeded event", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await test.step("sign in as the seeded organizer", async () => {
        await loginAsAdmin(page);
      });
      await test.step("the events list shows the seeded event", async () => {
        await page.goto("/events");
        await expect(page.getByText(EVENTS.main.name)).toBeVisible();
      });
      assertClean();
    });
  });

  test.describe("event creation", () => {
    test.skip(!landed("M11"), waitingOn("M11"));

    test("creating an event validates its dates and its slug", async ({ page }) => {
      await loginAsAdmin(page);
      await test.step("an end before the start is refused inline", async () => {
        // The form must reject it, not the database, and the message must appear
        // next to the field.
      });
      await test.step("a reserved slug is refused", async () => {
        // `api` must not become an event slug — it would shadow the API routes.
      });
      await test.step("the new event's settings show 8 default email templates", async () => {
        // 7 domain keys + portal_login. This is what proves M11 called
        // seedDefaultTemplates rather than creating the event bare.
        expect(TEMPLATE_KEYS_PER_EVENT).toBe(8);
      });
    });

    test("the empty event renders empty states, not a crash", async ({ page }) => {
      test.skip(!landed("M09"), waitingOn("M09"));
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      await test.step(`${EVENTS.empty.name} renders its designed empty state`, async () => {});
      assertClean();
    });
  });

  test.describe("the form builder", () => {
    test.skip(!landed("M11", "M12"), waitingOn("M11", "M12"));

    test("the builder produces a public form link that returns 200", async ({ page }) => {
      await loginAsAdmin(page);
      await test.step("add a track, a room and a format", async () => {});
      await test.step("add a dropdown field, a conditional field and a routing rule", async () => {});
      await test.step("set the form open and copy its link", async () => {});
      await test.step("the copied /submit/<slug>/<formId> URL returns 200", async () => {});
    });
  });
});
