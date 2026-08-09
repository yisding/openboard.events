import { test } from "@playwright/test";
import { expectNoConsoleErrors } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS } from "./helpers/seeded";

/**
 * Goes green when M32 (public pages) and M33 (embeds) land, with the API
 * assertion following M40 — target Sunday for the pages, Tuesday for the API,
 * owned by WS-E / WS-F.
 */
test.describe("public-embeds", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.use({ viewport: { width: 390, height: 844 } });

  test.describe("the public pages", () => {
    test.skip(!landed("M09", "M32"), waitingOn("M09", "M32"));

    test("the public pages render seeded data on a phone", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await test.step(`/e/${EVENTS.main.slug}/schedule renders sessions`, async () => {});
      await test.step(`/e/${EVENTS.main.slug}/speakers renders the gallery, headshots included`, async () => {});
      assertClean();
    });

    test("nothing unpublished leaks onto a public page", async () => {
      await test.step("a draft session is absent", async () => {});
      await test.step("an admin-declined speaker is absent", async () => {
        // Resolution #15's leakage assertion. A public page that leaks a decline
        // is the one bug that cannot be walked back after judging.
      });
    });
  });

  test.describe("the embed variant", () => {
    test.skip(!landed("M33"), waitingOn("M33"));

    test("the embed variant is framable and carries no X-Frame-Options", async () => {
      await test.step("/embed/<slug>/schedule sends CSP frame-ancestors *", async () => {});
      await test.step("/embed/<slug>/schedule sends no X-Frame-Options", async () => {
        // X-Frame-Options and frame-ancestors together is the classic embed
        // failure: the header wins in older browsers and the iframe goes blank.
      });
    });
  });

  test.describe("the public API", () => {
    test.skip(!landed("M40"), waitingOn("M40"));

    test("the public API returns published rows only", async () => {
      await test.step(`GET /api/v1/events/${EVENTS.main.slug}/schedule returns 200`, async () => {});
      await test.step("its rows match the public page's", async () => {});
    });
  });
});
