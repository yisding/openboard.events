import { expect, test } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { BASE_URL, NO_TARGET, targetConfigured } from "./helpers/env";
import { seedId } from "./helpers/ids";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, SESSIONS } from "./helpers/seeded";

/**
 * Goes green when M32 (public pages) and M33 (embeds) land, with the API
 * assertion following M40 — target Sunday for the pages, Tuesday for the API,
 * owned by WS-E / WS-F.
 */

const SCHEDULE = `/e/${EVENTS.main.slug}/schedule`;
const GALLERY = `/e/${EVENTS.main.slug}/speakers`;

/**
 * Two seeded speakers, both on published sessions, put into the two states the
 * leakage rule is about.
 *
 * The seed leaves every contact `unconfirmed` (only `notifyDecisions`'
 * auto-confirm or an organizer's override ever sets `confirmed`), so a spec
 * that asserted the gallery renders seeded people would be asserting an empty
 * page. Arranging both states explicitly, through M27's own route, is what
 * makes "confirmed appears / declined does not" a real comparison rather than
 * two absences.
 */
const CONFIRMED = { contactId: seedId("contact", "ada"), name: "Ada Lovelace" };
const DECLINED = { contactId: seedId("contact", "grace"), name: "Grace Hopper" };

type PublicSession = { id: string; title: string; startsAt: string };

test.describe("public-embeds", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.use({ viewport: { width: 390, height: 844 } });

  // A worker-scoped hook, so it reads the target from the environment rather
  // than from the test-scoped `baseURL` option, and it does nothing at all when
  // the suite is not pointed at a deployment.
  test.beforeAll(async ({ playwright }) => {
    if (!targetConfigured() || !landed("M09", "M32")) return;
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      await loginAsAdmin(request);
      for (const [speaker, status] of [[CONFIRMED, "confirmed"], [DECLINED, "declined"]] as const) {
        await apiData(request, `/api/internal/speakers/${EVENTS.main.id}/${speaker.contactId}`, {
          method: "PATCH",
          data: { confirmationStatus: status },
        });
      }
    } finally {
      await request.dispose();
    }
  });

  test.describe("the public pages", () => {
    test.skip(!landed("M09", "M32"), waitingOn("M09", "M32"));

    test("the public pages render seeded data on a phone", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);

      await test.step(`/e/${EVENTS.main.slug}/schedule renders sessions`, async () => {
        await page.goto(SCHEDULE);
        await expect(page.getByText(SESSIONS.publishedKeynote.title)).toBeVisible();
        // Day tabs, not one flat list: the seeded programme spans two days and
        // the tabs are how a phone reader gets to the second one.
        await expect(page.locator(".public-day-tabs button")).toHaveCount(2);
        const overflows = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        expect(overflows, "the public schedule must not scroll sideways at 390px").toBe(false);
      });

      await test.step(`/e/${EVENTS.main.slug}/speakers renders the gallery, headshots included`, async () => {
        // `revalidate = 60` and no write revalidates the route, so the confirm
        // in beforeAll needs the cache window to expire. Polled rather than
        // slept through.
        await expect(async () => {
          await page.goto(GALLERY);
          await expect(page.getByText(CONFIRMED.name)).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 120_000, intervals: [5_000] });
        // A real headshot, served from M07's immutable `/f/<fileId>` route —
        // the seeded contact carries one, so an initials placeholder here means
        // the file row or the object is missing.
        await expect(page.locator('img[src^="/f/"]').first()).toBeVisible();
      });

      assertClean();
    });

    test("nothing unpublished leaks onto a public page", async ({ page }) => {
      await test.step("a draft session is absent", async () => {
        await page.goto(SCHEDULE);
        // Across every day tab, not just the one that happens to be selected.
        const tabs = page.locator(".public-day-tabs button");
        for (let index = 0; index < await tabs.count(); index += 1) {
          await tabs.nth(index).click();
          await expect(page.getByText(SESSIONS.draftUnscheduled.title)).toHaveCount(0);
        }
        // And it is genuinely still a draft rather than absent for some other
        // reason — the public API reads the same view the page does.
        const api = await page.request.get(`/api/v1/events/${EVENTS.main.slug}/schedule?cb=${Date.now()}`);
        const body = await api.json() as { data: PublicSession[] };
        expect(body.data.map((session) => session.title)).not.toContain(SESSIONS.draftUnscheduled.title);
      });

      await test.step("an admin-declined speaker is absent", async () => {
        // Resolution #15's leakage assertion. A public page that leaks a decline
        // is the one bug that cannot be walked back after judging.
        await expect(async () => {
          await page.goto(GALLERY);
          await expect(page.getByText(CONFIRMED.name)).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 120_000, intervals: [5_000] });
        await expect(page.getByText(DECLINED.name)).toHaveCount(0);
        // Their session stays on the schedule; only their identity is withheld.
        await page.goto(SCHEDULE);
        await expect(page.getByText(SESSIONS.backToBackEarly.title)).toBeVisible();
        await expect(page.getByText(DECLINED.name)).toHaveCount(0);
      });
    });
  });

  test.describe("the embed variant", () => {
    test.skip(!landed("M33"), waitingOn("M33"));

    test("the embed variant is framable and carries no X-Frame-Options", async ({ page, request }) => {
      const response = await request.get(`/embed/${EVENTS.main.slug}/schedule`);
      expect(response.status()).toBe(200);
      const headers = response.headers();

      await test.step("/embed/<slug>/schedule sends CSP frame-ancestors *", async () => {
        expect(headers["content-security-policy"] ?? "").toContain("frame-ancestors *");
      });

      await test.step("/embed/<slug>/schedule sends no X-Frame-Options", async () => {
        // X-Frame-Options and frame-ancestors together is the classic embed
        // failure: the header wins in older browsers and the iframe goes blank.
        expect(headers["x-frame-options"]).toBeUndefined();
        // The non-embed page keeps the deny, so this is a targeted exemption
        // rather than a hole in the site's headers.
        const publicPage = await request.get(SCHEDULE);
        expect((publicPage.headers()["x-frame-options"] ?? "").toUpperCase()).toBe("DENY");
      });

      await test.step("the embed renders the same published sessions", async () => {
        await page.goto(`/embed/${EVENTS.main.slug}/schedule`);
        await expect(page.getByText(SESSIONS.publishedKeynote.title)).toBeVisible();
        await expect(page.getByText(SESSIONS.draftUnscheduled.title)).toHaveCount(0);
      });
    });
  });

  test.describe("the public API", () => {
    test.skip(!landed("M40"), waitingOn("M40"));

    test("the public API returns published rows only", async ({ page, request }) => {
      let titles: string[] = [];

      await test.step(`GET /api/v1/events/${EVENTS.main.slug}/schedule returns 200`, async () => {
        const response = await request.get(`/api/v1/events/${EVENTS.main.slug}/schedule?cb=${Date.now()}`);
        expect(response.status()).toBe(200);
        // Public, cacheable, and callable from another origin — an embed or a
        // judge's script is the intended caller.
        expect(response.headers()["access-control-allow-origin"]).toBe("*");
        expect(response.headers()["cache-control"] ?? "").toContain("s-maxage=60");
        const body = await response.json() as { data: PublicSession[]; meta: { count: number; event: { slug: string } } };
        expect(body.meta.event.slug).toBe(EVENTS.main.slug);
        expect(body.meta.count).toBe(body.data.length);
        titles = body.data.map((session) => session.title);
        expect(titles).toContain(SESSIONS.publishedKeynote.title);
        expect(titles).not.toContain(SESSIONS.draftUnscheduled.title);
      });

      await test.step("its rows match the public page's", async () => {
        // One source (`published_sessions_v`) means the API and the page cannot
        // disagree about what is published — asserted by comparing the two sets,
        // which is the only way that claim is worth anything.
        await page.goto(SCHEDULE);
        const tabs = page.locator(".public-day-tabs button");
        const rendered = new Set<string>();
        for (let index = 0; index < await tabs.count(); index += 1) {
          await tabs.nth(index).click();
          for (const heading of await page.locator(".public-session-main h3").allInnerTexts()) {
            rendered.add(heading.trim());
          }
        }
        expect([...rendered].sort()).toEqual([...new Set(titles)].sort());
      });
    });
  });

  test.describe("the empty event", () => {
    test.skip(!landed("M09", "M32"), waitingOn("M09", "M32"));

    test("the empty event's public surfaces render their empty states", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      // The standing empty-state probe: an empty public page that crashes is a
      // judged failure, and this is the cheapest place to catch it.
      //
      // Every surface, by the copy it actually renders. M53 split the single
      // combined "/schedule" view into five distinct surfaces, each with its
      // own empty state, and this probe had gone on asserting the old page's
      // wording — so it was testing a URL that now 307s to the agenda rather
      // than the five pages a visitor can reach. The legacy path stays first in
      // the list precisely because that redirect still has to land somewhere.
      const surfaces = [
        ["schedule", "Agenda coming soon"],
        ["sessions", "Sessions coming soon"],
        ["agenda", "Agenda coming soon"],
        ["itinerary", "Schedule coming soon"],
        ["speakers", "Speakers coming soon"],
        ["gallery", "Speakers coming soon"],
      ] as const;
      for (const [surface, emptyCopy] of surfaces) {
        await page.goto(`/e/${EVENTS.empty.slug}/${surface}`);
        await expect(page.getByText(emptyCopy), `/e/${EVENTS.empty.slug}/${surface} renders its empty state`).toBeVisible();
      }
      assertClean();
    });
  });
});
