import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin, loginAsSpeaker } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, TASKS } from "./helpers/seeded";

/**
 * Goes green when M21 (portal shell), M22 (profile) and M25 (task runtime) land
 * — target CP3, owned by WS-D.
 */

const PORTAL = `/portal/${EVENTS.main.slug}`;
const BIO_LIMIT = 5000;

type SpeakerRow = { contactId: string; name: string; email: string; openTasks: number; isAcceptedSpeaker: boolean };

/**
 * Who to sign in as, discovered rather than hard-coded.
 *
 * Task assignment flows from `accepted_speakers_v`, and which seeded contact
 * ends up on an accepted submission is decided by `scripts/seed/submissions.ts`
 * ordering `contacts` by `created_at` — every row of which is written in one
 * transaction and therefore carries the same timestamp. The set of speakers
 * with tasks is stable; *which* of them it is, is not. Asking the Speakers
 * admin read (M27) is what makes this spec deterministic anyway.
 */
async function speakerWithOpenTasks(request: APIRequestContext, minimumOpen: number): Promise<SpeakerRow> {
  await loginAsAdmin(request);
  const list = await apiData<{ rows: SpeakerRow[] }>(
    request,
    `/api/internal/speakers/${EVENTS.main.id}?accepted=1&sort=openTasks&dir=desc&pageSize=100`,
  );
  const speaker = list.rows.find((row) => row.openTasks >= minimumOpen);
  expect(
    speaker,
    `no accepted speaker has ${minimumOpen} open tasks — the portal seed assigns three per accepted speaker`,
  ).toBeTruthy();
  return speaker as SpeakerRow;
}

/** The "Tasks to do" tile on the portal home, which reads `speaker_outstanding_v`. */
async function outstandingCount(page: Page): Promise<number> {
  await page.goto(PORTAL);
  const tile = page.locator(".stat-tile", { hasText: "Tasks to do" });
  await expect(tile).toBeVisible();
  return Number((await tile.locator(".stat-tile__value").innerText()).trim());
}

test.describe("portal-tasks", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("the profile", () => {
    test.skip(!landed("M21", "M22"), waitingOn("M21", "M22"));

    test("a speaker signs in and saves a profile", async ({ page, request }) => {
      const assertClean = expectNoConsoleErrors(page);
      const speaker = await speakerWithOpenTasks(request, 1);

      await test.step("sign in through the normal OTP challenge", async () => {
        await loginAsSpeaker(page, EVENTS.main.slug, speaker.email);
        await page.goto(`${PORTAL}/profile`);
        await expect(page.getByRole("heading", { name: "Speaker profile" })).toBeVisible();
      });

      await test.step("the bio counter reads 5,000 and the server refuses more", async () => {
        // Both halves matter: a client-only limit is not a limit.
        const bio = `E2E bio ${Date.now()}`;
        await page.getByRole("textbox", { name: "Biography", exact: true }).click();
        await page.keyboard.type(bio);
        // The counter is rendered from `plainTextLength`, the same function the
        // server's refine uses — they cannot disagree, and this asserts the
        // number a speaker actually reads.
        await expect(page.getByText(new RegExp(`/ ${BIO_LIMIT} characters`))).toBeVisible();
        await page.getByRole("button", { name: /save/i }).first().click();
        await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 20_000 });

        // The server half, on the speaker's own session: an over-limit bio is
        // refused with a typed validation error, not silently truncated.
        const oversized = await page.request.fetch(`/api/internal/portal/profile?eventId=${EVENTS.main.id}`, {
          method: "PATCH",
          data: { bioHtml: `<p>${"x".repeat(BIO_LIMIT + 1)}</p>` },
        });
        expect(oversized.status(), "an over-limit bio must be refused by the server").toBe(400);
        const body = await oversized.json() as { error?: { code?: string; fieldErrors?: Record<string, string> } };
        expect(body.error?.code).toBe("VALIDATION");
        expect(body.error?.fieldErrors?.bioHtml ?? "").toMatch(new RegExp(`under ${BIO_LIMIT} characters`));

        // And the refusal changed nothing: the saved bio is still the saved bio.
        await page.reload();
        await expect(page.getByRole("textbox", { name: "Biography", exact: true })).toContainText(bio);
      });

      assertClean();
    });
  });

  test.describe("task completion", () => {
    test.skip(!landed("M21", "M25"), waitingOn("M21", "M25"));

    test("a speaker completes a manual task and a file-request task", async ({ page, request }) => {
      const assertClean = expectNoConsoleErrors(page);
      // Two open tasks at least: the manual one and the file request. The seed
      // marks one manual completion for its first contact, so a speaker with
      // fewer than two open would be that contact.
      const speaker = await speakerWithOpenTasks(request, 2);
      await loginAsSpeaker(page, EVENTS.main.slug, speaker.email);
      const before = await outstandingCount(page);
      expect(before, "the chosen speaker should owe something").toBeGreaterThan(0);

      await test.step("complete the manual task", async () => {
        await page.goto(`${PORTAL}/tasks`);
        await page.getByRole("link", { name: new RegExp(TASKS.manual.name) }).first().click();
        await expect(page.getByRole("heading", { name: TASKS.manual.name })).toBeVisible();
        await page.getByRole("button", { name: /mark as complete/i }).click();
        await expect(page).toHaveURL(new RegExp(`${PORTAL}/tasks$`), { timeout: 20_000 });
        // The list's default filter is Open, so a completed task leaves it.
        await expect(page.getByRole("link", { name: new RegExp(TASKS.manual.name) })).toHaveCount(0);
      });

      await test.step("upload a small fixture to the file-request task", async () => {
        // Exercises M07's presign → PUT → finalize path from a browser, which is
        // the only place CORS is actually proven.
        await page.goto(`${PORTAL}/tasks`);
        await page.getByRole("link", { name: new RegExp(TASKS.fileRequest.name) }).first().click();
        await expect(page.getByRole("heading", { name: TASKS.fileRequest.name })).toBeVisible();
        const filename = `e2e-slides-${Date.now()}.pdf`;
        await page.locator('.file-upload input[type="file"]').setInputFiles({
          name: filename,
          mimeType: "application/pdf",
          // A real (tiny) PDF: finalize checks what actually landed in R2, so a
          // text file with a .pdf name is not a fair probe of that path.
          buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
        });
        await expect(page.locator(".portal-uploads")).toContainText(filename, { timeout: 60_000 });
        await expect(page.locator(".portal-task-meta")).toContainText(/complete/i);
      });

      await test.step("the dashboard outstanding count drops on the next poll", async () => {
        // The count comes from `speaker_outstanding_v`, so this asserts the
        // completions reached the read model — not just that a button changed.
        await expect.poll(() => outstandingCount(page), { message: "two completions should reduce the open count", timeout: 30_000 })
          .toBe(before - 2);
      });

      assertClean();
    });
  });
});

/** M25's AC: portal login through file-task completion at phone width. */
test.describe("portal-tasks on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(!targetConfigured(), NO_TARGET);
  test.skip(!landed("M21", "M25"), waitingOn("M21", "M25"));

  test("login and file completion work at 390px", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    const speaker = await speakerWithOpenTasks(request, 1);

    await test.step("the task list and the upload control are usable at 390px", async () => {
      await loginAsSpeaker(page, EVENTS.main.slug, speaker.email);
      const overflows = async () => page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(await overflows(), "the portal home must not scroll sideways at 390px").toBe(false);

      await page.goto(`${PORTAL}/tasks`);
      await expect(page.locator(".portal-task-card").first()).toBeVisible();
      expect(await overflows(), "the task list must not scroll sideways at 390px").toBe(false);

      await page.getByRole("link", { name: new RegExp(TASKS.fileRequest.name) }).first().click();
      const chooser = page.getByRole("button", { name: /choose a file|upload a newer version/i });
      await expect(chooser).toBeVisible();
      // Tappable, not merely present: a control smaller than a fingertip on the
      // one screen M25's AC names is a failure a desktop run never sees.
      const box = await chooser.boundingBox();
      expect(box?.height ?? 0, "the upload control must be tappable").toBeGreaterThanOrEqual(32);
      expect(await overflows(), "the task detail must not scroll sideways at 390px").toBe(false);
    });

    assertClean();
  });
});
