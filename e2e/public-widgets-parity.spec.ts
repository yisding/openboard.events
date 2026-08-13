import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { getSpeakerPublicSnapshot, restoreSpeakerConfirmation, type SpeakerPublicSnapshot } from "./helpers/cleanup";
import { BASE_URL, NO_TARGET, targetConfigured } from "./helpers/env";
import { seedId } from "./helpers/ids";
import { EVENTS, SESSIONS, VOCAB } from "./helpers/seeded";

/**
 * M53's own spec, distinct from M32/M33's `public-embeds.spec.ts`: that file
 * covers the combined-shell/leakage/CSP baseline the five surfaces were split
 * out of. This file owns the five-surface split itself — the named
 * search/filter/day/detail interaction on each surface, the anonymous
 * itinerary star/reload/export round trip, cross-surface-and-organizer
 * parity, and embed configurability/parity — per the M53 work order's
 * acceptance criteria.
 *
 * Goes green when M53 lands on a deployed preview — target the P5
 * product-completeness wave, owned by WS-E.
 */

/**
 * `/api/v1/events/[slug]/{schedule,speakers}` as those routes actually answer:
 * a `{ data, meta }` envelope over a flat array, with vocabulary flattened to
 * *names* (the DTO is written out by hand at the route boundary, deliberately —
 * see the speakers route's own comment) and a contact's id spelled `id`. The
 * earlier declarations here described a nested `{ sessions: [...] }` shape with
 * `{ id, name }` vocabulary objects that this API has never returned, so every
 * step reading them died on `undefined`.
 */
type PublishedSession = {
  id: string; title: string; startsAt: string; endsAt: string;
  room: string | null; track: string | null; format: string | null;
  speakers: Array<{ id: string; firstName: string; lastName: string; company: string | null; title: string | null }>;
};
type PublishedSpeaker = {
  id: string; firstName: string; lastName: string; title: string | null; company: string | null;
  bioHtml: string | null; headshotUrl: string | null;
};
/** The organizer's own vocabulary, to compare the public *names* against the ids the admin API returns. */
type VocabItem = { id: string; name: string };
type ScheduledSession = {
  id: string; title: string; startsAt: string | null; endsAt: string | null;
  trackId: string | null; roomId: string | null; formatId: string | null; speakerIds: string[];
};
type SpeakerDetail = { contact: { contactId: string; name: string; jobTitle: string | null; company: string | null } };
type EmbedConfig = { id: string; eventId: string; contentType: string; enabled: boolean; style: Record<string, unknown>; filters: Record<string, unknown> };

const SLUG = EVENTS.main.slug;
const KEYNOTE = SESSIONS.publishedKeynote; // Ada Lovelace, confirmed below — the parity target session.
const ADA_ID = seedId("contact", "ada");
const GRACE_ID = seedId("contact", "grace");
const GRACE_NAME = "Grace Hopper";

const SURFACES = {
  sessions: `/e/${SLUG}/sessions`,
  agenda: `/e/${SLUG}/agenda`,
  itinerary: `/e/${SLUG}/itinerary`,
  speakers: `/e/${SLUG}/speakers`,
  gallery: `/e/${SLUG}/gallery`,
} as const;

/** Narrows `T | undefined` to `T` with a real assertion (never a `!`), so a
 * missing seeded fixture fails with the message that says what is missing
 * instead of a generic "Cannot read properties of undefined". */
function must<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeTruthy();
  return value as T;
}

/** One row-array out of the public API's `{ data, meta }` envelope. */
async function fetchPublic<T>(page: Page, path: string): Promise<T[]> {
  const response = await page.request.get(`${path}${path.includes("?") ? "&" : "?"}cb=${Date.now()}`);
  expect(response.ok(), `${path} → ${response.status()}`).toBe(true);
  const body = await response.json() as { data?: T[]; meta?: { count: number } };
  expect(Array.isArray(body.data), `${path} should answer a { data: [...] } envelope`).toBe(true);
  expect(body.meta?.count, `${path}'s meta.count should agree with its own rows`).toBe(body.data?.length);
  return body.data ?? [];
}

/** Every direct/embed page reads the search/session/speaker deep link after
 * hydration to stay `revalidate = 60` cacheable — a fresh confirm/decline
 * only shows up once that window (or a revalidate call) has caught up. */
async function waitForVisible(page: Page, url: string, text: string): Promise<void> {
  await expect(async () => {
    await page.goto(url);
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000, intervals: [5_000] });
}

test.describe("public-widgets-parity (M53)", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.use({ viewport: { width: 390, height: 844 } });
  const originalConfirmations = new Map<string, SpeakerPublicSnapshot["confirmationStatus"]>();

  // Every surface in this file is `revalidate = 60`, so each navigation is
  // wrapped in a retry window of up to 120 s (`waitForVisible`, and the embed
  // test's five iframes). Those windows do not fit inside Playwright's 30 s
  // default, which turned a cold cache into "element(s) not found" long before
  // the retry loop had done its job — the timeouts were the assertion's own
  // budget being cut off, not the page failing to render. The assertions are
  // unchanged; only the budget they were written against is now declared.
  test.beforeEach(({}, testInfo) => { testInfo.setTimeout(180_000); });

  // Worker-scoped: temporarily puts Ada/Grace into the two states the leakage
  // checks compare, then restores the seed's exact public state in `afterAll`.
  test.beforeAll(async ({ playwright }) => {
    if (!targetConfigured()) return;
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      await loginAsAdmin(request);
      for (const contactId of [ADA_ID, GRACE_ID]) {
        const snapshot = await getSpeakerPublicSnapshot(request, EVENTS.main.id, contactId);
        originalConfirmations.set(contactId, snapshot.confirmationStatus);
      }
      await apiData(request, `/api/internal/speakers/${EVENTS.main.id}/${ADA_ID}`, { method: "PATCH", data: { confirmationStatus: "confirmed" } });
      await apiData(request, `/api/internal/speakers/${EVENTS.main.id}/${GRACE_ID}`, { method: "PATCH", data: { confirmationStatus: "declined" } });
    } finally {
      await request.dispose();
    }
  });

  test.afterAll(async ({ playwright }) => {
    if (originalConfirmations.size === 0) return;
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      await loginAsAdmin(request);
      for (const [contactId, confirmationStatus] of originalConfirmations) {
        await restoreSpeakerConfirmation(request, EVENTS.main.id, contactId, confirmationStatus);
      }
    } finally {
      await request.dispose();
      originalConfirmations.clear();
    }
  });

  test.describe("five distinct surfaces, each with its own interaction", () => {
    test("sessions list: search and the Track/Format/Location filters narrow the same grid", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await waitForVisible(page, SURFACES.sessions, KEYNOTE.title);

      await test.step("search narrows to the matching card and an empty query restores the rest", async () => {
        await page.getByPlaceholder("Search sessions or speakers").fill("year agents grew up");
        await expect(page.locator(".session-card")).toHaveCount(1);
        await expect(page.getByText(SESSIONS.draftUnscheduled.title)).toHaveCount(0);
        await page.getByPlaceholder("Search sessions or speakers").fill("");
        await expect(page.locator(".session-card").first()).toBeVisible();
      });

      await test.step("the Format filter narrows to the one Keynote-format session", async () => {
        await page.getByLabel("Filter by format").selectOption({ label: "Keynote" });
        await expect(page.locator(".session-card")).toHaveCount(1);
        await expect(page.getByText(KEYNOTE.title)).toBeVisible();
        await page.getByLabel("Filter by format").selectOption({ label: "All formats" });
      });

      await test.step("the Track filter narrows out a session from another track", async () => {
        await page.getByLabel("Filter by track").selectOption({ label: "AI Agents" });
        await expect(page.getByText(KEYNOTE.title)).toBeVisible();
        await expect(page.getByText(SESSIONS.backToBackEarly.title)).toHaveCount(0); // "Platforms" track
        await page.getByLabel("Filter by track").selectOption({ label: "All tracks" });
      });

      await test.step("the Location filter narrows to sessions in that room", async () => {
        await page.getByLabel("Filter by location").selectOption({ label: "Main Stage" });
        await expect(page.getByText(KEYNOTE.title)).toBeVisible();
        await page.getByLabel("Filter by location").selectOption({ label: "All locations" });
      });

      await test.step("a description expands and collapses in place", async () => {
        const card = page.locator(".session-card", { hasText: KEYNOTE.title });
        await expect(card.locator(".session-card-desc.truncated")).toBeVisible();
        await card.getByRole("button", { name: `Read more about ${KEYNOTE.title}` }).click();
        await expect(card).toHaveClass(/expanded/);
        await expect(card.locator(".session-card-desc.truncated")).toHaveCount(0);
        await card.getByRole("button", { name: `Show less about ${KEYNOTE.title}` }).click();
        await expect(card).not.toHaveClass(/expanded/);
      });

      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflows, "the sessions list must not scroll sideways at 390px").toBe(false);
      assertClean();
    });

    test("agenda: day navigation, and a reversible detail that keeps the active day", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await waitForVisible(page, SURFACES.agenda, KEYNOTE.title);

      const tabs = page.locator(".public-day-tabs button");
      await expect(tabs).toHaveCount(2);

      // Find whichever tab actually holds the keynote — dayOffset is seed
      // machinery, not something this spec should hard-code.
      let keynoteDayIndex = -1;
      for (let i = 0; i < await tabs.count(); i += 1) {
        await tabs.nth(i).click();
        if (await page.getByText(KEYNOTE.title).count() > 0) { keynoteDayIndex = i; break; }
      }
      expect(keynoteDayIndex, "the keynote must be on one of the two seeded days").toBeGreaterThanOrEqual(0);

      await test.step("expanding a detail preserves the active day, and collapsing it does too", async () => {
        await page.getByRole("button", { name: KEYNOTE.title, exact: true }).click();
        await expect(page.locator(".session-detail")).toBeVisible();
        // Scoped to the detail panel: the collapsed row already carries the
        // speaker's name as its own byline, so a bare `getByText` resolves to
        // two nodes and fails strict mode without telling you which one the
        // step is about. The claim is "the expanded detail names the speaker".
        await expect(page.locator(".session-detail").getByText("Ada Lovelace")).toBeVisible();
        await expect(tabs.nth(keynoteDayIndex)).toHaveClass(/active/);
        await page.getByRole("button", { name: KEYNOTE.title, exact: true }).click();
        await expect(page.locator(".session-detail")).toHaveCount(0);
        await expect(tabs.nth(keynoteDayIndex)).toHaveClass(/active/);
      });

      await test.step("switching days deliberately collapses any open detail", async () => {
        await page.getByRole("button", { name: KEYNOTE.title, exact: true }).click();
        await expect(page.locator(".session-detail")).toBeVisible();
        const otherDay = 1 - keynoteDayIndex;
        await tabs.nth(otherDay).click();
        await expect(page.locator(".session-detail")).toHaveCount(0);
        await expect(tabs.nth(otherDay)).toHaveClass(/active/);
      });

      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflows, "the agenda must not scroll sideways at 390px").toBe(false);
      assertClean();
    });

    test("speakers list: surname-sorted search narrows to one row with bio and session detail", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await waitForVisible(page, SURFACES.speakers, "Ada Lovelace");

      await page.getByPlaceholder("Search speakers, companies, or topics").fill(KEYNOTE.title);
      await expect(page.locator(".speakers-list li")).toHaveCount(1);
      const row = page.locator(".speakers-list li", { hasText: "Ada Lovelace" });
      await row.getByRole("button").click();
      await expect(row).toHaveClass(/expanded/);
      await expect(row.locator(".speaker-detail-sessions li", { hasText: KEYNOTE.title })).toBeVisible();

      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflows, "the speakers list must not scroll sideways at 390px").toBe(false);
      assertClean();
    });

    test("speaker gallery: searchable photo grid with a headshot-or-initials fallback and a full profile", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await waitForVisible(page, SURFACES.gallery, "Ada Lovelace");

      // Every visible card has a headshot image or an initials fallback —
      // never neither (a broken avatar is the standing regression here).
      const cards = page.locator(".speaker-gallery article");
      const cardCount = await cards.count();
      expect(cardCount).toBeGreaterThan(0);
      for (let i = 0; i < cardCount; i += 1) {
        const card = cards.nth(i);
        const hasImage = await card.locator("img.person-avatar").count();
        // `SpeakerAvatar` renders the fallback as a `<span class="person-avatar
        // person-avatar-xl">JG</span>` — there is no `initials` class anywhere
        // in the tree, so the earlier `[class*='initial']` selector could only
        // ever match zero and reported "no avatar at all" for every seeded
        // speaker who deliberately has no headshot.
        const hasInitials = await card.locator("span.person-avatar").count();
        expect(hasImage + hasInitials, "each gallery card needs a headshot or an initials fallback").toBeGreaterThan(0);
      }

      await page.getByPlaceholder("Search speakers, companies, or topics").fill(KEYNOTE.title);
      await expect(cards).toHaveCount(1);
      await cards.first().getByRole("button", { name: /view profile for/i }).click();
      await expect(page.locator(".speaker-detail")).toBeVisible();
      await expect(page.locator(".speaker-detail-sessions li", { hasText: KEYNOTE.title })).toBeVisible();
      await page.getByRole("button", { name: /back to all speakers/i }).click();
      await expect(page.locator(".speaker-detail")).toHaveCount(0);
      await expect(cards.first()).toBeVisible();

      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflows, "the speaker gallery must not scroll sideways at 390px").toBe(false);
      assertClean();
    });
  });

  test("itinerary: star two, reload, see exactly two, remove one, export only the remainder", async ({ page }) => {
    const assertClean = expectNoConsoleErrors(page);
    const second = SESSIONS.backToBackLate; // "Evals that survive contact with users" — a second, distinct published session.
    await waitForVisible(page, SURFACES.itinerary, KEYNOTE.title);

    await test.step("starring two sessions updates the My Schedule count", async () => {
      await page.getByRole("button", { name: `Add ${KEYNOTE.title} to My Schedule` }).click();
      await page.getByRole("button", { name: `Add ${second.title} to My Schedule` }).click();
      await expect(page.getByRole("button", { name: /My Schedule \(2\)/ })).toBeVisible();
    });

    await test.step("a reload persists exactly the two starred sessions", async () => {
      await page.reload();
      await expect(page.getByRole("button", { name: /My Schedule \(2\)/ })).toBeVisible();
      await page.getByRole("button", { name: /My Schedule \(2\)/ }).click(); // filter to starred-only
      await expect(page.locator(".itinerary-sessions article")).toHaveCount(2);
      await expect(page.getByText(KEYNOTE.title)).toBeVisible();
      await expect(page.getByText(second.title)).toBeVisible();
    });

    await test.step("removing one leaves exactly one, in both the count and the filtered list", async () => {
      await page.getByRole("button", { name: `Remove ${second.title} from My Schedule` }).click();
      await expect(page.getByRole("button", { name: /My Schedule \(1\)/ })).toBeVisible();
      await expect(page.locator(".itinerary-sessions article")).toHaveCount(1);
      await expect(page.getByText(KEYNOTE.title)).toBeVisible();
      await expect(page.getByText(second.title)).toHaveCount(0);
    });

    await test.step("the export link is exactly the remaining session, and its .ics contains only that session", async () => {
      const exportLink = page.locator("a.itinerary-export");
      const href = must(await exportLink.getAttribute("href") ?? undefined, "the export link must have an href once a session is starred");
      const params = new URL(href, BASE_URL || "http://localhost").searchParams;
      expect(params.getAll("session")).toEqual([KEYNOTE.id]);

      const response = await page.request.get(href);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"] ?? "").toContain("text/calendar");
      const ics = await response.text();
      expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
      expect(ics).toContain(`SUMMARY:${KEYNOTE.title}`);
      expect(ics).not.toContain(`SUMMARY:${second.title}`);
    });

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, "the itinerary must not scroll sideways at 390px").toBe(false);
    assertClean();
  });

  test("one session and speaker agree across all five surfaces and the organizer's own admin API", async ({ page, playwright }) => {
    let organizerSession: ScheduledSession | undefined;
    let organizerSpeaker: SpeakerDetail | undefined;
    let publicSession: PublishedSession | undefined;
    let publicSpeaker: PublishedSpeaker | undefined;
    // The public API flattens vocabulary to names while the admin API returns
    // ids, so parity is only checkable through the organizer's own vocabulary.
    const vocabularyName = new Map<string, string>();

    await test.step("gather the organizer's own view of the keynote and Ada", async () => {
      const request = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        await loginAsAdmin(request);
        const sessions = await apiData<ScheduledSession[]>(request, `/api/internal/agenda/sessions?eventId=${EVENTS.main.id}`);
        organizerSession = sessions.find((s) => s.id === KEYNOTE.id);
        const detail = await apiData<SpeakerDetail>(request, `/api/internal/speakers/${EVENTS.main.id}/${ADA_ID}`);
        organizerSpeaker = detail;
        for (const kind of ["rooms", "tracks", "formats"] as const) {
          for (const item of await apiData<VocabItem[]>(request, `/api/internal/events/${EVENTS.main.id}/vocab/${kind}`)) {
            vocabularyName.set(item.id, item.name);
          }
        }
      } finally {
        await request.dispose();
      }
    });

    await test.step("the public API's session and speaker match the organizer's, field for field", async () => {
      const schedule = await fetchPublic<PublishedSession>(page, `/api/v1/events/${SLUG}/schedule`);
      publicSession = schedule.find((s) => s.id === KEYNOTE.id);
      const speakers = await fetchPublic<PublishedSpeaker>(page, `/api/v1/events/${SLUG}/speakers`);
      publicSpeaker = speakers.find((s) => s.id === ADA_ID);

      const org = must(organizerSession, "the seeded keynote must exist in the organizer's own list");
      const pub = must(publicSession, "the seeded keynote must be published");
      const orgSpeaker = must(organizerSpeaker, "Ada must resolve as a real speaker");
      const pubSpeaker = must(publicSpeaker, "Ada must be published (confirmed in beforeAll)");

      expect(pub.title).toBe(org.title);
      expect(pub.startsAt).toBe(org.startsAt);
      expect(pub.endsAt).toBe(org.endsAt);
      // Name-for-id through the organizer's own vocabulary: the claim is that
      // the two surfaces name the same room/track/format, not merely that both
      // are non-empty.
      expect(pub.room).toBe(org.roomId === null ? null : vocabularyName.get(org.roomId));
      expect(pub.track).toBe(org.trackId === null ? null : vocabularyName.get(org.trackId));
      expect(pub.format).toBe(org.formatId === null ? null : vocabularyName.get(org.formatId));
      expect(org.speakerIds).toContain(ADA_ID);
      expect(pub.speakers.map((s) => s.id)).toContain(ADA_ID);

      expect(`${pubSpeaker.firstName} ${pubSpeaker.lastName}`).toBe(orgSpeaker.contact.name);
      expect(pubSpeaker.title).toBe(orgSpeaker.contact.jobTitle);
      expect(pubSpeaker.company).toBe(orgSpeaker.contact.company);
    });

    await test.step("the same title, room, and speaker render identically on all five direct surfaces", async () => {
      const pub = must(publicSession, "the keynote must have resolved in the previous step");
      const roomName = pub.room ?? "";
      // The speakers endpoint is a roster, not a per-speaker session list, so
      // the speaker-to-session link is read where the API actually carries it:
      // the keynote's own `speakers` array, asserted above.
      expect(pub.speakers.map((s) => `${s.firstName} ${s.lastName}`), "the public keynote must carry Ada back").toContain("Ada Lovelace");

      await waitForVisible(page, SURFACES.sessions, KEYNOTE.title);
      await expect(page.locator(".session-card", { hasText: KEYNOTE.title })).toContainText(roomName);
      await expect(page.locator(".session-card", { hasText: KEYNOTE.title })).toContainText("Ada Lovelace");

      // Every remaining surface is reached through the same eventually-cached
      // retry as `waitForVisible` (see its own comment) — this test runs
      // after every other test in the file in this suite's `workers: 1`
      // sequential run, so the cache is normally warm by now, but a
      // standalone `--grep` of just this test must not flake on it.
      await expect(async () => {
        await page.goto(SURFACES.agenda);
        const tabs = page.locator(".public-day-tabs button");
        for (let i = 0; i < await tabs.count(); i += 1) {
          await tabs.nth(i).click();
          if (await page.getByText(KEYNOTE.title).count() > 0) return;
        }
        throw new Error("keynote not yet visible on any agenda day");
      }).toPass({ timeout: 120_000, intervals: [5_000] });
      const agendaRow = page.locator(".public-session-main", { hasText: KEYNOTE.title });
      await expect(agendaRow).toContainText(roomName);
      await expect(agendaRow).toContainText("Ada Lovelace");

      await waitForVisible(page, SURFACES.itinerary, KEYNOTE.title);
      const itineraryRow = page.locator(".itinerary-sessions article", { hasText: KEYNOTE.title });
      await expect(itineraryRow).toContainText(roomName);
      await expect(itineraryRow).toContainText("Ada Lovelace");

      await waitForVisible(page, SURFACES.speakers, "Ada Lovelace");
      await page.locator(".speakers-list li", { hasText: "Ada Lovelace" }).getByRole("button").click();
      await expect(page.locator(".speaker-detail-sessions li", { hasText: KEYNOTE.title })).toContainText(roomName);

      await waitForVisible(page, SURFACES.gallery, "Ada Lovelace");
      await page.getByRole("button", { name: "View profile for Ada Lovelace", exact: true }).click();
      await expect(page.locator(".speaker-detail-sessions li", { hasText: KEYNOTE.title })).toContainText(roomName);
    });
  });

  test("draft and declined-speaker data is absent from every direct surface, every embed, and both public APIs", async ({ page }) => {
    const directPages = Object.entries(SURFACES);
    const embedRoutes: Array<[string, string]> = [
      ["sessions", `/embed/${SLUG}/sessions`],
      ["agenda", `/embed/${SLUG}/agenda`],
      ["itinerary", `/embed/${SLUG}/itinerary`],
      ["speakers", `/embed/${SLUG}/speakers`],
      ["gallery", `/embed/${SLUG}/gallery`],
    ];

    await test.step("the draft session is absent from every direct and embed surface", async () => {
      for (const [, url] of [...directPages, ...embedRoutes]) {
        await page.goto(url);
        await expect(page.getByText(SESSIONS.draftUnscheduled.title)).toHaveCount(0);
      }
    });

    await test.step("Grace's session stays published, but her declined identity is withheld everywhere", async () => {
      for (const [, url] of [...directPages, ...embedRoutes]) {
        await page.goto(url);
        await expect(page.getByText(GRACE_NAME)).toHaveCount(0);
      }
      // Her session itself (title only, no speaker byline) still renders on the
      // session-shaped surfaces — this is the withheld-identity rule, not a
      // second draft-style exclusion.
      await waitForVisible(page, SURFACES.sessions, SESSIONS.backToBackEarly.title);
    });

    await test.step("both public APIs agree: no draft title, no declined speaker", async () => {
      const schedule = await fetchPublic<PublishedSession>(page, `/api/v1/events/${SLUG}/schedule`);
      expect(schedule.map((s) => s.title)).not.toContain(SESSIONS.draftUnscheduled.title);
      const speakers = await fetchPublic<PublishedSpeaker>(page, `/api/v1/events/${SLUG}/speakers`);
      expect(speakers.map((s) => `${s.firstName} ${s.lastName}`)).not.toContain(GRACE_NAME);
    });
  });

  test.describe("embeds", () => {
    test("all five embeds render populated content in a cross-origin host, and both variants are edge-cacheable", async ({ page }) => {
      const targets: Array<{ route: string; needle: string }> = [
        { route: "sessions", needle: KEYNOTE.title },
        { route: "agenda", needle: KEYNOTE.title },
        { route: "itinerary", needle: KEYNOTE.title },
        { route: "speakers", needle: "Ada Lovelace" },
        { route: "gallery", needle: "Ada Lovelace" },
      ];

      // A *network-scheme* host origin, fulfilled locally rather than fetched:
      // the previous `data:` host could never have worked, and not because of
      // anything this app does. CSP says `frame-ancestors *` matches only
      // ancestors with a network scheme, so Chromium blocks the frame outright
      // ("Framing … violates … frame-ancestors *. Note that '*' matches only
      // URLs with a network scheme") and the iframe stays empty. `page.route`
      // intercepts before DNS, so this stays offline and deterministic while
      // still being a genuinely different origin from the preview.
      const targetOrigin = new URL(BASE_URL);
      let hostHtml = "";
      let HOST_ORIGIN = "https://embed-host.e2e";
      let closeHost = async () => { await page.unroute(`${HOST_ORIGIN}/**`); };
      if (targetOrigin.protocol === "http:") {
        // A route-fulfilled synthetic host is classified as public by Chromium
        // and cannot frame localhost under Local Network Access. A real
        // ephemeral loopback server stays offline and deterministic while
        // providing the genuinely different origin this check promises.
        const server = createServer((_request, response) => {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(hostHtml);
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        HOST_ORIGIN = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        closeHost = async () => {
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        };
      } else {
        await page.route(`${HOST_ORIGIN}/**`, (route) => route.fulfill({ contentType: "text/html", body: hostHtml }));
      }

      try {
        for (const { route, needle } of targets) {
          await test.step(`/embed/${SLUG}/${route} renders inside a genuinely cross-origin host`, async () => {
            hostHtml = `<!doctype html><html><body><iframe id="w" src="${BASE_URL}/embed/${SLUG}/${route}" style="width:390px;height:900px;border:0"></iframe></body></html>`;
            await page.goto(`${HOST_ORIGIN}/${route}`);
            const frame = page.frameLocator("#w");
            await expect(async () => {
              await expect(frame.getByText(needle).first()).toBeVisible({ timeout: 5_000 });
            }).toPass({ timeout: 120_000, intervals: [5_000] });
          });
        }

        // Both the direct and embed variants must be served from the edge cache,
        // not re-rendered on every visitor — the M53 caching-regression fix
        // (status.md rev. 11) is what makes the second assertion here possible
        // at all; the embed used to be `private, no-cache` on every request.
        for (const [label, url] of [["direct", SURFACES.agenda], ["embed", `/embed/${SLUG}/agenda`]] as const) {
          await test.step(`the ${label} agenda page is edge-cacheable`, async () => {
            let cached = false;
            for (let attempt = 0; attempt < 5 && !cached; attempt += 1) {
              const response = await page.request.get(url);
              cached = (response.headers()["cache-control"] ?? "").includes("s-maxage=");
              if (!cached) await page.waitForTimeout(2_000);
            }
            expect(cached, `${url} never became edge-cached`).toBe(true);
          });
        }
      } finally {
        await closeHost();
      }
    });

    test("a saved style/filter change and a disabled kill switch both take effect on the embed's next load", async ({ page, playwright }) => {
      const request = await playwright.request.newContext({ baseURL: BASE_URL });
      let sessionsConfig: EmbedConfig | undefined;
      let galleryConfig: EmbedConfig | undefined;
      try {
        await loginAsAdmin(request);
        const configs = await apiData<EmbedConfig[]>(request, `/api/internal/embeds/${EVENTS.main.id}`);
        sessionsConfig = configs.find((c) => c.contentType === "session_list");
        galleryConfig = configs.find((c) => c.contentType === "speaker_gallery");
        const sessionsCfg = must(sessionsConfig, "the session_list embed config must exist");
        const galleryCfg = must(galleryConfig, "the speaker_gallery embed config must exist");

        await test.step("a saved accent/theme and a track filter both appear on the next embed load", async () => {
          await apiData(request, `/api/internal/embeds/${EVENTS.main.id}/${sessionsCfg.id}`, {
            method: "PATCH",
            data: { style: { accent: "#1144ff", theme: "dark", showHeader: true }, filters: { trackIds: [VOCAB.tracks.agents] } },
          });
          await expect(async () => {
            await page.goto(`/embed/${SLUG}/sessions`);
            await expect(page.locator(".embed-shell.embed-dark")).toBeVisible({ timeout: 5_000 });
          }).toPass({ timeout: 120_000, intervals: [5_000] });
          const accent = await page.locator(".embed-shell").evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim());
          expect(accent).toBe("#1144ff");
          // Only the "AI Agents" track survives the filter.
          await expect(page.getByText(KEYNOTE.title)).toBeVisible();
          await expect(page.getByText(SESSIONS.backToBackEarly.title)).toHaveCount(0); // "Platforms" track
        });

        await test.step("disabling a content type serves the inert state instead of its data", async () => {
          await apiData(request, `/api/internal/embeds/${EVENTS.main.id}/${galleryCfg.id}`, { method: "PATCH", data: { enabled: false } });
          await expect(async () => {
            await page.goto(`/embed/${SLUG}/gallery`);
            await expect(page.getByText("This speaker gallery is not currently available.")).toBeVisible({ timeout: 5_000 });
          }).toPass({ timeout: 120_000, intervals: [5_000] });
          await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
        });
      } finally {
        // Restore both configs exactly, so a later run of this spec (or
        // `public-embeds.spec.ts`, sharing the same seeded event) never
        // inherits a filtered/disabled embed left over from this test.
        if (sessionsConfig) {
          await apiData(request, `/api/internal/embeds/${EVENTS.main.id}/${sessionsConfig.id}`, {
            method: "PATCH",
            data: { style: sessionsConfig.style, filters: sessionsConfig.filters },
          }).catch(() => {});
        }
        if (galleryConfig) {
          await apiData(request, `/api/internal/embeds/${EVENTS.main.id}/${galleryConfig.id}`, {
            method: "PATCH",
            data: { enabled: galleryConfig.enabled },
          }).catch(() => {});
        }
        await request.dispose();
      }
    });
  });

  test("keyboard: an expanded agenda detail's state survives navigating away and coming back", async ({ page }) => {
    const assertClean = expectNoConsoleErrors(page);
    await waitForVisible(page, SURFACES.agenda, KEYNOTE.title);
    const tabs = page.locator(".public-day-tabs button");
    for (let i = 0; i < await tabs.count(); i += 1) {
      await tabs.nth(i).click();
      if (await page.getByText(KEYNOTE.title).count() > 0) break;
    }

    await test.step("the session row opens its detail from the keyboard, not only a click", async () => {
      const row = page.getByRole("button", { name: KEYNOTE.title, exact: true });
      await row.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".session-detail")).toBeVisible();
      // Tab does not get trapped inside the detail panel — focus keeps moving.
      const focusedBefore = await page.evaluate(() => document.activeElement?.tagName);
      await page.keyboard.press("Tab");
      const focusedAfter = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedBefore === focusedAfter && focusedAfter === "BODY").toBe(false);
    });

    await test.step("navigating to the speaker and back restores the same expanded detail from the URL", async () => {
      await expect(page).toHaveURL(new RegExp(`[?&]session=${KEYNOTE.id}`));
      await page.getByRole("link", { name: "Ada Lovelace" }).click();
      await expect(page).toHaveURL(new RegExp(`/e/${SLUG}/speakers`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`[?&]session=${KEYNOTE.id}`));
      await expect(page.locator(".session-detail")).toBeVisible();
      await expect(page.getByText(KEYNOTE.title)).toBeVisible();
    });

    assertClean();
  });
});
