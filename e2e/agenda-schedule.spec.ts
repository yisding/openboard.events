import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, SESSIONS } from "./helpers/seeded";

/**
 * Goes green when M28 (sessions CRUD), M29 (conflict engine) and M31 (views)
 * land — target CP3, owned by WS-E.
 *
 * No drag simulation anywhere in this file: quality-strategy §3 bans it and drag
 * is verified by hand. Sessions are placed through the edit dialog.
 */

const AGENDA = `/events/${EVENTS.main.id}/agenda`;

type SessionDTO = { id: string; title: string; startsAt: string | null; status: string; rowVersion: number };

/** The Conflicts tab's badge, which is absent rather than "0" when there is nothing to flag. */
async function conflictBadge(page: Page): Promise<number> {
  const tab = page.locator(".agenda-view-tabs [role='tab']", { hasText: "Conflicts" });
  await expect(tab).toBeVisible();
  const badge = tab.locator("span");
  return (await badge.count()) === 0 ? 0 : Number((await badge.first().innerText()).trim());
}

/** The event-zone calendar date of a seeded session, as `<input type="datetime-local">` wants it. */
function eventDay(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENTS.main.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

/** Places a session through the dialog — the only edit surface, per the DnD ban. */
async function fillPlacement(dialog: Locator, room: string, startsLocal: string, endsLocal: string): Promise<void> {
  await dialog.getByLabel("Room").selectOption({ label: room });
  const unscheduled = dialog.getByLabel(/leave unscheduled/i);
  if (await unscheduled.isChecked()) await unscheduled.uncheck();
  // Ends is written after Starts: setting Starts recomputes Ends from the
  // format's default duration, so the reverse order loses the end time.
  await dialog.getByLabel("Starts").fill(startsLocal);
  await dialog.getByLabel("Ends").fill(endsLocal);
}

test.describe("agenda-schedule", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("conflict detection", () => {
    test.skip(!landed("M28", "M29"), waitingOn("M28", "M29"));

    test("overlapping sessions in one room raise exactly one conflict", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);

      // Both placed in the Atrium late in the evening, where the seeded
      // programme has nothing: the assertion is about the *delta* this test
      // creates, not about the seeded conflicts it shares the board with.
      const sessions = await apiData<SessionDTO[]>(page.request, `/api/internal/agenda/sessions?eventId=${EVENTS.main.id}`);
      const anchor = sessions.find((session) => session.id === SESSIONS.publishedKeynote.id);
      expect(anchor?.startsAt, "the seeded keynote anchors the event's first day").toBeTruthy();
      const day = eventDay(anchor?.startsAt ?? new Date().toISOString());
      const stamp = Date.now();
      const first = `E2E overlap A ${stamp}`;
      const second = `E2E overlap B ${stamp}`;

      await page.goto(AGENDA);
      const baseline = await conflictBadge(page);

      await test.step("place two sessions in one room at overlapping times", async () => {
        // Through the edit dialog — never a simulated drag.
        for (const [title, start, end] of [
          [first, `${day}T20:00`, `${day}T20:30`],
          [second, `${day}T20:15`, `${day}T20:45`],
        ] as const) {
          await page.getByRole("button", { name: /add session/i }).click();
          const dialog = page.getByRole("dialog", { name: "Create a session" });
          await dialog.getByLabel("Session title").fill(title);
          await fillPlacement(dialog, "Atrium", start, end);
          await dialog.getByRole("button", { name: /save session/i }).click();
          await expect(dialog).toHaveCount(0, { timeout: 20_000 });
        }
      });

      await test.step("the Conflicts tab badge reads 1", async () => {
        // One more than before: a room double-booking is exactly one conflict,
        // not one per session.
        await expect.poll(() => conflictBadge(page), { message: "the overlap should raise one conflict", timeout: 20_000 })
          .toBe(baseline + 1);
        await page.goto(`${AGENDA}?view=conflicts`);
        const row = page.locator(".agenda-conflict-row", { hasText: first });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("Room conflict");
        await expect(row).toContainText(second);
      });

      await test.step("making them back-to-back drops the badge to 0", async () => {
        // The half-open interval assertion: [start, end) means touching is not
        // overlapping, and this is the case that regresses silently.
        await page.goto(`${AGENDA}?view=list`);
        await page.getByRole("row", { name: new RegExp(second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
        const dialog = page.getByRole("dialog", { name: "Edit session" });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("Starts").fill(`${day}T20:30`);
        await dialog.getByLabel("Ends").fill(`${day}T21:00`);
        await dialog.getByRole("button", { name: /save session/i }).click();
        await expect(dialog).toHaveCount(0, { timeout: 20_000 });

        await expect.poll(() => conflictBadge(page), { message: "touching intervals must not conflict", timeout: 20_000 })
          .toBe(baseline);
      });

      assertClean();
    });
  });

  test.describe("the seeded conflict pair", () => {
    test.skip(!landed("M09", "M29"), waitingOn("M09", "M29"));

    test("the seeded conflict pair is flagged and the back-to-back pair is not", async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto(`${AGENDA}?view=conflicts`);

      await test.step(`${SESSIONS.conflictA} and ${SESSIONS.conflictB} are flagged`, async () => {
        // The seed documents both pairs as binding: A is a room double-booking,
        // B is one speaker in two rooms at once.
        const roomPair = page.locator(".agenda-conflict-row", { hasText: SESSIONS.conflictA });
        await expect(roomPair).toHaveCount(1);
        await expect(roomPair).toContainText("Room conflict");
        await expect(roomPair).toContainText(SESSIONS.conflictA1.title);
        await expect(roomPair).toContainText(SESSIONS.conflictA2.title);

        const speakerPair = page.locator(".agenda-conflict-row", { hasText: SESSIONS.conflictB });
        await expect(speakerPair).toHaveCount(1);
        await expect(speakerPair).toContainText("Speaker conflict");
      });

      await test.step("the seeded back-to-back pair is not flagged", async () => {
        // 10:00–10:30 followed by 10:30–11:00 in the same room is a normal
        // programme; an engine that reddens it is one organizers stop trusting.
        const conflicts = page.locator(".agenda-conflict-row");
        await expect(conflicts.filter({ hasText: SESSIONS.backToBackEarly.title })).toHaveCount(0);
        await expect(conflicts.filter({ hasText: SESSIONS.backToBackLate.title })).toHaveCount(0);
        // And the seeded board carries exactly the two documented conflicts —
        // "exactly two, not three" is a stated property of the seeded schedule.
        // Rows this suite created itself are excluded so a failure above cannot
        // masquerade as a seed regression here.
        await expect(conflicts.filter({ hasNotText: "E2E" })).toHaveCount(2);
      });
    });
  });

  test.describe("the views", () => {
    test.skip(!landed("M28", "M31"), waitingOn("M28", "M31"));

    test("every agenda view renders the same session set", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);

      // Six views over one server-authoritative array (M31). Each is asserted on
      // its own root and on a session it must contain, so a view that renders an
      // empty shell cannot pass by rendering its tab.
      for (const [view, root] of [
        ["list", ".data-panel"],
        ["day", ".dv-root"],
        ["week", ".agenda-week"],
        ["track", ".agenda-lanes"],
        ["room", ".agenda-lanes"],
      ] as const) {
        await page.goto(`${AGENDA}?view=${view}`);
        await expect(page.locator(".agenda-view-tabs [role='tab'][aria-selected='true']")).toHaveText(new RegExp(view, "i"));
        await expect(page.locator(root).first()).toBeVisible();
      }

      // The day-scoped views share one day switcher, and the toolbar's zone note
      // is what keeps a 9pm session off tomorrow's tab for a reader elsewhere.
      await expect(page.getByText(`All times ${EVENTS.main.timezone}`)).toBeVisible();

      await page.goto(`${AGENDA}?view=list`);
      await expect(page.getByText(SESSIONS.publishedKeynote.title)).toBeVisible();
      // The tray is the unscheduled rows' home; a session with no time must
      // still be reachable, which is what the List view's `<Dash>` cells cover.
      await expect(page.getByText(SESSIONS.draftUnscheduled.title)).toBeVisible();

      assertClean();
    });
  });

  test.describe("publishing", () => {
    test.skip(!landed("M28", "M32"), waitingOn("M28", "M32"));

    test("publishing a session puts it on the public schedule", async ({ page }) => {
      await loginAsAdmin(page);
      const sessions = await apiData<SessionDTO[]>(page.request, `/api/internal/agenda/sessions?eventId=${EVENTS.main.id}`);
      const anchor = sessions.find((session) => session.id === SESSIONS.publishedKeynote.id);
      const day = eventDay(anchor?.startsAt ?? new Date().toISOString());

      const title = `E2E publish me ${Date.now()}`;

      await test.step("publish one session", async () => {
        // Its own draft rather than a seeded one: `public-embeds` asserts that
        // the seeded drafts never leak onto a public page, and a spec that
        // publishes one of them would quietly disarm that assertion.
        await page.goto(`${AGENDA}?view=list`);
        await page.getByRole("button", { name: /add session/i }).click();
        const create = page.getByRole("dialog", { name: "Create a session" });
        await create.getByLabel("Session title").fill(title);
        await fillPlacement(create, "Studio", `${day}T19:00`, `${day}T19:30`);
        await create.getByRole("button", { name: /save session/i }).click();
        await expect(create).toHaveCount(0, { timeout: 20_000 });

        // Draft and placed; publishing is the second, separate act.
        await page.getByRole("row", { name: new RegExp(title) }).first().click();
        const edit = page.getByRole("dialog", { name: "Edit session" });
        await expect(edit).toBeVisible();
        await edit.getByLabel("Status").selectOption("published");
        await edit.getByRole("button", { name: /save session/i }).click();
        await expect(edit).toHaveCount(0, { timeout: 20_000 });
      });

      await test.step("it appears on /e/<slug>/schedule within the cache window", async () => {
        // The public route is `revalidate = 60` and nothing revalidates it on a
        // write, so the assertion is deliberately a poll across that window
        // rather than a single read that would be racing the cache.
        await expect(async () => {
          await page.goto(`/e/${EVENTS.main.slug}/schedule`);
          await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 120_000, intervals: [5_000] });
      });
    });
  });
});
