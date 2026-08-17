import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin, loginAsSpeaker } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { EVENTS } from "./helpers/seeded";

/**
 * Resources — the speaker handbook, from the organizer's editor to the page a
 * speaker reads, against the deployed preview.
 *
 * `src/features/portal/resources` is one of the two README-listed flows with
 * no automated walk-through at all. The reason to run it in a real browser
 * rather than in PGlite is that its central guarantee is a *rendering* one and
 * a *leakage* one, neither of which a server unit test can settle:
 *
 *  - "HTML source" is the only way to paste an embed, and what survives that
 *    round trip is decided twice — `sanitize(html, {profile:'wide'})` on save
 *    and `<RichTextView wide>` on render. Only a browser can say whether the
 *    script that was pasted actually *ran*;
 *  - an unpublished page must be invisible in the portal and indistinguishable
 *    from one that never existed — a 404, never a 403;
 *  - and a page an organizer unpublishes has to disappear from the portal
 *    while remaining editable in the admin table.
 */

const EVENT = EVENTS.main.id;
const RESOURCES_API = `/api/internal/resources/${EVENT}`;
const RESOURCES_ADMIN = `/events/${EVENT}/resources`;
const PORTAL_RESOURCES = `/portal/${EVENTS.main.slug}/resources`;

/** `scripts/seed/resources.ts`'s three probes, by the slugs it pins. */
const SEEDED = {
  guide: { slug: "speaker-guide", title: "Speaker Guide" },
  /** Published, and carrying both an allowlisted iframe and two XSS payloads. */
  probe: { slug: "venue-travel", title: "Venue & Travel" },
  /** Unpublished on purpose: the leakage probe for the portal. */
  draft: { slug: "internal-notes", title: "Internal Notes" },
} as const;

const EMBED_SRC = "https://www.youtube.com/embed/dQw4w9WgXcQ";
/** Set by either payload if the sanitizer ever let one through. */
const XSS_FLAG = "__e2eResourceXss";

type ResourcePageRow = { id: string; title: string; slug: string; published: boolean };

/**
 * Answers the sanitizer question behaviorally: not "is the markup gone" but
 * "did anything run". A `<script>` that the render-side sanitizer stripped and
 * an `onerror` that never fired both leave this undefined.
 */
const xssFired = (page: Page): Promise<boolean> =>
  page.evaluate((flag) => Boolean((window as unknown as Record<string, unknown>)[flag]), XSS_FLAG);

/**
 * The embed host is stubbed rather than fetched. The assertion is about our
 * sanitizer's decision and the page's CSP `frame-src`, and a spec that depends
 * on a third party being up is a spec that fails for reasons it is not about.
 */
async function stubEmbedHost(page: Page): Promise<void> {
  await page.route("https://www.youtube.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>embed stub</title>" }));
}

async function anAcceptedSpeaker(request: APIRequestContext): Promise<{ contactId: string; email: string }> {
  await loginAsAdmin(request);
  const list = await apiData<{ rows: Array<{ contactId: string; email: string }> }>(
    request,
    `/api/internal/speakers/${EVENT}?accepted=1&pageSize=1`,
  );
  const speaker = list.rows[0];
  expect(speaker, "the seed accepts at least one speaker, who is who reads the portal").toBeTruthy();
  return speaker as { contactId: string; email: string };
}

test.describe("portal-resources", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  // A portal OTP round trip plus two authoring saves does not fit in 30 s.
  test.beforeEach(({}, testInfo) => { testInfo.setTimeout(180_000); });

  // Every page this spec authors is titled `E2E resource …`, so teardown never
  // has to guess and can never take out a seeded or hand-authored page.
  test.afterEach(async ({ request }) => {
    if (!targetConfigured()) return;
    await loginAsAdmin(request);
    const pages = await apiData<ResourcePageRow[]>(request, RESOURCES_API);
    for (const page of pages.filter((row) => row.title.startsWith("E2E resource "))) {
      await apiData(request, `${RESOURCES_API}/${page.id}`, { method: "DELETE" });
    }
  });

  test("an organizer authors a page with an embed, a speaker reads it sanitized, and unpublishing hides it again", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);
    await stubEmbedHost(page);

    const stamp = Date.now();
    const title = `E2E resource ${stamp}`;
    const slug = `e2e-resource-${stamp}`;
    const heading = `Arrival ${stamp}`;

    await test.step("the admin table shows published and draft pages alike", async () => {
      await page.goto(RESOURCES_ADMIN);
      await expect(page.getByRole("heading", { name: "Resources", level: 1 })).toBeVisible();
      await expect(page.getByRole("row", { name: SEEDED.guide.title })).toContainText("Published");
      // The one page the portal must never show is still an organizer's to see.
      await expect(page.getByRole("row", { name: SEEDED.draft.title })).toContainText("Draft");
    });

    await test.step("HTML source is where an embed is pasted, and it is the only way", async () => {
      await page.getByRole("button", { name: "New page" }).first().click();
      const editor = page.getByRole("dialog", { name: "New resource page" });
      await expect(editor).toBeVisible();
      await editor.getByLabel("Title").fill(title);
      await editor.getByLabel("URL").fill(slug);

      await editor.getByRole("tab", { name: "HTML source" }).click();
      await editor.getByLabel("HTML source").fill([
        `<h2>${heading}</h2>`,
        "<p>Doors open at eight.</p>",
        `<iframe src="${EMBED_SRC}" title="Venue walkthrough" width="560" height="315" allowfullscreen></iframe>`,
        `<script>window.${XSS_FLAG} = true;</script>`,
        `<img src="x" onerror="window.${XSS_FLAG} = true">`,
      ].join(""));

      await editor.getByRole("button", { name: "Create page" }).click();
      await expect(page.getByText("Page created")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("row", { name: title })).toContainText("Published");
    });

    const speaker = await anAcceptedSpeaker(request);
    const portal = await page.context().newPage();
    const assertPortalClean = expectNoConsoleErrors(portal);
    await stubEmbedHost(portal);

    await test.step("the speaker finds the page, and the payloads inside it never run", async () => {
      await loginAsSpeaker(portal, EVENTS.main.slug, speaker.email);
      await portal.goto(PORTAL_RESOURCES);
      await portal.getByRole("textbox", { name: "Search resources" }).fill(String(stamp));
      await portal.getByRole("link", { name: title }).click();

      await expect(portal.getByRole("heading", { name: title })).toBeVisible();
      await expect(portal.getByRole("heading", { name: heading })).toBeVisible();
      // The embed survived — sanitizing an organizer's video into nothing is
      // the failure that made "HTML source" pointless.
      await expect(portal.locator(".resource-detail-page iframe")).toHaveAttribute("src", EMBED_SRC);
      expect(await xssFired(portal), "a pasted <script>/onerror must never execute in the portal").toBe(false);
      const article = await portal.locator(".resource-detail-page article").innerHTML();
      expect(article).not.toContain("onerror");
      expect(article).not.toContain("<script");
    });

    await test.step("the seeded probe proves the render-side sanitizer, not only the save-side one", async () => {
      // `scripts/seed/resources.ts` writes this page's body *raw*, bypassing
      // `saveResourcePageIn` — so what is stripped here can only have been
      // stripped by `<RichTextView wide>` on render.
      await portal.goto(`${PORTAL_RESOURCES}/${SEEDED.probe.slug}`);
      await expect(portal.getByRole("heading", { name: SEEDED.probe.title })).toBeVisible();
      await expect(portal.locator(".resource-detail-page iframe")).toHaveAttribute("src", EMBED_SRC);
      expect(await xssFired(portal), "unsanitized stored HTML is still sanitized on the way out").toBe(false);
      expect(await portal.locator(".resource-detail-page article").innerHTML()).not.toContain("<script");
    });

    await test.step("an unpublished page is a 404 in the portal, never a 403", async () => {
      await portal.goto(PORTAL_RESOURCES);
      await expect(portal.getByRole("link", { name: SEEDED.draft.title })).toHaveCount(0);
      const direct = await portal.request.get(`${PORTAL_RESOURCES}/${SEEDED.draft.slug}`);
      expect(direct.status(), "a draft and a slug that never existed answer identically").toBe(404);
      const missing = await portal.request.get(`${PORTAL_RESOURCES}/never-existed-${stamp}`);
      expect(missing.status()).toBe(404);
    });

    await test.step("unpublishing removes the page from the portal without deleting it", async () => {
      await page.goto(RESOURCES_ADMIN);
      await page.getByRole("row", { name: title }).getByRole("button", { name: "Edit" }).click();
      const editor = page.getByRole("dialog", { name: "Edit resource page" });
      await expect(editor).toBeVisible();
      await editor.getByRole("switch", { name: "Published" }).click();
      await editor.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Page updated")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("row", { name: title })).toContainText("Draft");

      expect((await portal.request.get(`${PORTAL_RESOURCES}/${slug}`)).status()).toBe(404);
      await portal.goto(PORTAL_RESOURCES);
      await expect(portal.getByRole("link", { name: title })).toHaveCount(0);
    });

    assertPortalClean();
    await portal.close();
    assertClean();
  });
});
