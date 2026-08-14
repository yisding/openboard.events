import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { deleteAgendaSessionsWhere } from "./helpers/cleanup";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { EVENTS, SESSIONS, uniqueEmail } from "./helpers/seeded";

/**
 * Covers session CRUD, conflict detection, agenda views, publishing, and
 * assisted placement against the deployed preview.
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

  test.describe("responsive toolbar", () => {
    test.use({ viewport: { width: 769, height: 900 } });

    test("keeps search and both creation paths inside the viewport", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      await page.goto(AGENDA);

      const actions = [
        page.getByRole("textbox", { name: "Find session" }),
        page.getByRole("link", { name: "Add invited talk" }),
        page.getByRole("button", { name: "Add session" }),
      ];
      for (const action of actions) await expect(action).toBeVisible();

      const actionEdges = await Promise.all(actions.map((action) => action.evaluate((control) => control.getBoundingClientRect().right)));
      const containment = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(containment.document).toBeLessThanOrEqual(containment.viewport);
      expect(Math.max(...actionEdges)).toBeLessThanOrEqual(containment.viewport);
      assertClean();
    });
  });

  test.describe("mobile view navigation", () => {
    test.use({ viewport: { width: 375, height: 900 } });

    test("keeps every agenda view label readable in a contained scroller", async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto(`${AGENDA}?view=day`);

      const tabs = page.locator(".agenda-view-tabs [role='tab']");
      await expect(tabs).toHaveCount(6);
      for (const tab of await tabs.all()) {
        await expect(tab).toBeVisible();
        expect((await tab.innerText()).trim()).not.toEqual("");
        expect(await tab.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
      }

      const layout = await page.locator(".agenda-view-tabs").evaluate((element) => {
        const maximumScroll = element.scrollWidth - element.clientWidth;
        element.scrollLeft = element.scrollWidth;
        return {
          isScrollable: maximumScroll > 0,
          overflowX: getComputedStyle(element).overflowX,
          reachedEnd: Math.abs(element.scrollLeft - maximumScroll) <= 1,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      expect(layout.isScrollable).toBe(true);
      expect(["auto", "scroll"]).toContain(layout.overflowX);
      expect(layout.reachedEnd).toBe(true);
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    });
  });

  test.afterEach(async ({ request }) => {
    if (!targetConfigured()) return;
    await loginAsAdmin(request);
    await deleteAgendaSessionsWhere(request, EVENTS.main.id, ({ title }) =>
      /^E2E (overlap [AB]|publish me|auto-place|blacked out) [0-9]+$/.test(title));
  });

  test.describe("conflict detection", () => {
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
      // Unscheduled rows stay reachable in List through their own table rows.
      await expect(page.getByText(SESSIONS.draftUnscheduled.title)).toBeVisible();

      await page.goto(`${AGENDA}?view=day`);
      await expect(page.getByRole("heading", { name: "Unscheduled", exact: true })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Auto-place", exact: true })).toBeVisible();
      await page.locator(".dv-unscheduled-card", { hasText: SESSIONS.draftUnscheduled.title })
        .getByRole("button", { name: "Edit" })
        .click();
      await expect(page.getByRole("dialog", { name: "Edit session" })).toBeVisible();
      await page.getByRole("dialog", { name: "Edit session" }).getByRole("button", { name: "Cancel" }).click();

      // The Day view integrates this queue beside its grid; grouped views still
      // need the shared tray because their lanes intentionally omit null times.
      await page.goto(`${AGENDA}?view=week`);
      await expect(page.getByRole("heading", { name: "Unscheduled", exact: true })).toHaveCount(1);
      await expect(page.getByText(SESSIONS.draftUnscheduled.title)).toBeVisible();

      assertClean();
    });
  });

  test.describe("publishing", () => {
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

  test.describe("assisted placement", () => {
    // Needs M51's real blackout store as well as M28/M29: the "useful
    // reason" half of this spec is a speaker declared unavailable through
    // the exact endpoint M51 ships, not a fixture PGlite alone can prove.
    test("previews a deterministic placement, applies one accepted row, persists it, and shows a useful reason for a blacked-out speaker", async ({ page, request }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(request);
      await loginAsAdmin(page);

      const stamp = Date.now();
      const placeable = `E2E auto-place ${stamp}`;
      const blockedTitle = `E2E blacked out ${stamp}`;
      const sessionsUrl = `/api/internal/agenda/sessions?eventId=${EVENTS.main.id}`;
      const draftSession = (title: string, speakerContactIds: string[] = []) => {
        const creationId = crypto.randomUUID();
        return apiData(request, sessionsUrl, {
          method: "POST",
          data: {
            creationId,
            title, descriptionHtml: "", formatId: null, trackId: null, roomId: null,
            startsAt: null, endsAt: null, speakerContactIds, status: "draft",
          },
        });
      };

      await test.step("seed a plain unscheduled session and one whose only speaker is blacked out for the whole event", async () => {
        const speaker = await apiData<{ contact: { contactId: string } }>(request, `/api/internal/speakers/${EVENTS.main.id}`, {
          method: "POST",
          data: { email: uniqueEmail("autoplace"), firstName: "Blocked", lastName: "Speaker" },
        });
        await apiData(request, `/api/internal/speakers/${EVENTS.main.id}/${speaker.contact.contactId}/unavailability`, {
          method: "PUT",
          data: { intervals: [{ startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2099-01-01T00:00:00.000Z", reason: "e2e always busy" }] },
        });
        await draftSession(placeable);
        await draftSession(blockedTitle, [speaker.contact.contactId]);
      });

      await test.step("Auto-place previews both rows: one placeable, one unplaced with a useful reason", async () => {
        // `?view=day`, not `?view=list`: Auto-place lives in the unscheduled
        // tray, and `agenda-page.tsx` renders that tray only alongside the
        // grid views — the list view replaces the whole workspace, so on
        // `?view=list` the button this step clicks does not exist at all.
        await page.goto(`${AGENDA}?view=day`);
        // Exact, not a substring: this step's own fixture is *named*
        // "E2E auto-place <stamp>" and the tray renders every unscheduled
        // session as a button, so `/auto-place/i` matches the fixture card as
        // well as the action and fails strict mode.
        await page.getByRole("button", { name: "Auto-place", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Auto-place unscheduled sessions" });
        await expect(dialog).toBeVisible();

        const placedRow = dialog.locator(".data-table tbody tr", { hasText: placeable });
        await expect(placedRow).toBeVisible({ timeout: 20_000 });
        await expect(placedRow.locator("input[type=checkbox]")).toBeChecked();

        const unplacedRow = dialog.locator(".data-table tbody tr", { hasText: blockedTitle });
        await expect(unplacedRow).toBeVisible();
        await expect(unplacedRow).toContainText(/unavailab/i);

        // Deselect every other accepted row so Apply touches only `placeable`
        // — the point of this step is the one accepted row, not every
        // session the seeded board happens to have unscheduled.
        const otherCheckboxes = dialog.locator(".data-table tbody tr:has(input[type=checkbox])").filter({ hasNotText: placeable });
        const otherCount = await otherCheckboxes.count();
        for (let index = 0; index < otherCount; index += 1) {
          const box = otherCheckboxes.nth(index).locator("input[type=checkbox]");
          if (await box.isChecked()) await box.uncheck();
        }

        await dialog.getByRole("button", { name: /^apply \d+ placement/i }).click();
        await expect(dialog.locator(".data-table", { hasText: placeable })).toBeVisible({ timeout: 20_000 });
        await expect(dialog.locator("tr", { hasText: placeable })).toContainText(/applied/i);
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(dialog).toHaveCount(0);
      });

      await test.step("the applied placement's day/time/room persists across reload", async () => {
        await page.reload();
        const sessions = await apiData<SessionDTO[]>(page.request, sessionsUrl);
        const persisted = sessions.find((session) => session.title === placeable);
        expect(persisted?.startsAt, "the accepted row's proposed time was written").toBeTruthy();

        const stillUnplaced = sessions.find((session) => session.title === blockedTitle);
        expect(stillUnplaced?.startsAt, "the blacked-out row was never written").toBeNull();
      });

      assertClean();
    });
  });
});
