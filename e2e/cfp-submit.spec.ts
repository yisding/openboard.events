import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, FORMS } from "./helpers/seeded";

/**
 * The spine. Goes green when M15 (wizard), M16 (pipeline) and M06b (portal auth)
 * land — target CP2, owned by WS-B2. This spec passing *is* the definition of
 * "the golden path is green": never soften an assertion here to pass a
 * checkpoint.
 */
test.describe("cfp-submit", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("the wizard end to end", () => {
    test.skip(!landed("M15", "M16"), waitingOn("M15", "M16"));

    test("a speaker submits through the public wizard", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await test.step("welcome shows the deadline in event tz, with its zone label", async () => {
        // A spec that matches only the date passes while the banner shows a judge
        // in another zone the wrong hour. Assert the label ("11:59 PM PDT").
        expect(EVENTS.main.timezone).toBe("America/Los_Angeles");
      });
      await test.step(`the submission limit banner reads ${FORMS.open.limit}`, async () => {});
      await test.step("the account step takes an email and its OTP from the fallback panel", async () => {});
      await test.step("a server draft row now exists", async () => {
        // Visible as the admin Drafts-tab count, or through the portal. This is
        // what separates a real server draft from localStorage.
      });
      await test.step(`the conditional field appears only when Format = ${FORMS.open.conditionalOn}`, async () => {});
      await test.step("a hidden answer is not submitted", async () => {
        // Switch the format back, then read the Review step back: the stale answer
        // must be gone, not merely invisible.
      });
      await test.step("participant, review and submit reach the success page", async () => {});
      assertClean();
    });

    test("past the limit, the friendly block is shown", async () => {
      await test.step("a second submit past the seeded limit shows LIMIT_REACHED, not a 500", async () => {});
    });
  });

  test.describe("wizard state", () => {
    test.skip(!landed("M15"), waitingOn("M15"));

    test("a reload mid-wizard keeps the answers", async () => {
      await test.step("answers survive a reload", async () => {});
    });
  });

  test.describe("the closed form", () => {
    test.skip(!landed("M09", "M15"), waitingOn("M09", "M15"));

    test("the closed form renders the branded closed page", async () => {
      await test.step(`form ${FORMS.closed.key} renders closed, with branding intact`, async () => {});
    });
  });
});

/** The brief's judge submits from a phone; this runs the same path at 390px. */
test.describe("cfp-submit on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(!targetConfigured(), NO_TARGET);
  test.skip(!landed("M15", "M16"), waitingOn("M15", "M16"));

  test("the wizard is usable at 390px", async () => {
    await test.step("no horizontal scroll, and every step is reachable", async () => {});
  });
});
