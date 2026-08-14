import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { eventDayKey, formatDayKeyInZone } from "../src/shared/lib/time";
import { waitForPortalLoginDelivery, waitForVerificationDelivery } from "./helpers/admin-auth-mail";
import { queryRows, withDatabase } from "./helpers/db";
import {
  databaseConfigured,
  E2E_FALLBACK_ACTIVATION,
  NO_DATABASE,
  NO_SIGNUP_JOURNEY,
  NO_TARGET,
  SIGNUP_EMAIL,
  signupJourneyConfigured,
  targetConfigured,
} from "./helpers/env";

const ONBOARDING_TIMEZONE = "America/Los_Angeles";

function addCalendarDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function eventNameInput(page: Page) {
  return page.getByRole("textbox", { name: /^Event name\s*\*?$/u });
}

function eventDateTimeInput(page: Page, label: "Starts" | "Ends") {
  return page.getByRole("combobox", { name: new RegExp(`^${label}\\b`, "u") });
}

function eventTimezoneInput(page: Page) {
  return page.getByRole("combobox", { name: /^Timezone\s*\*?$/u });
}

function proposalTitleInput(page: Page) {
  return page.getByRole("textbox", { name: "Title", exact: true });
}

async function chooseEventDateTime(page: Page, label: "Starts" | "Ends", daysFromNow: number, time: string): Promise<void> {
  const currentDay = eventDayKey(new Date(), ONBOARDING_TIMEZONE);
  const targetDay = addCalendarDays(currentDay, daysFromNow);
  const currentYear = Number(currentDay.slice(0, 4));
  const currentMonth = Number(currentDay.slice(5, 7));
  const targetYear = Number(targetDay.slice(0, 4));
  const targetMonth = Number(targetDay.slice(5, 7));
  const monthDelta = (targetYear - currentYear) * 12 + targetMonth - currentMonth;
  const [hour, minute] = time.split(":").map(Number);
  const input = eventDateTimeInput(page, label);

  await input.click();
  const picker = page.getByRole("dialog", { name: "Choose a date and time" });
  await expect(picker).toBeVisible();
  for (let month = 0; month < monthDelta; month += 1) {
    await picker.getByRole("button", { name: "Next month", exact: true }).click();
  }
  const targetDayName = formatDayKeyInZone(targetDay, ONBOARDING_TIMEZONE, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  await picker.getByRole("button", { name: targetDayName, exact: true }).click();
  await picker.getByLabel("Hour", { exact: true }).selectOption(String(hour));
  await picker.getByLabel("Minute", { exact: true }).selectOption(String(minute));
  await picker.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(input).not.toHaveValue("");
}

/**
 * Keep retries repeatable without ever deleting an arbitrary account that
 * happens to use the configured address. The controlled mailbox is dedicated
 * to this spec; an existing row without our name prefix is an operator error.
 */
async function removePriorTestAccount(email: string): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("BEGIN");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const emailBucketHashes = ["sign-up/email", "send-verification-email"].map((path) =>
        createHash("sha256").update(`auth-email:${path}:email:${normalizedEmail}`).digest("base64url"));
      // The mailbox is dedicated to this repeatable preview proof. Account
      // cleanup must reset its matching email counters too; otherwise repeated
      // deploy verification exhausts the real one-hour signup policy even
      // though every prior test account has been removed. IP counters remain
      // untouched, so the deployed abuse guard is still exercised.
      await client.query("DELETE FROM rate_limit_buckets WHERE key_hash = ANY($1::text[])", [emailBucketHashes]);
      const existing = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM users WHERE lower(email)=lower($1) LIMIT 1",
        [email],
      );
      const user = existing.rows[0];
      if (!user) {
        await client.query("COMMIT");
        return;
      }
      if (!user.name.startsWith("E2E Self-service ")) {
        throw new Error(`${email} already belongs to a non-E2E account; configure a dedicated signup mailbox`);
      }
      const owned = await client.query<{ organization_id: string; organization_name: string }>(
        `SELECT member.organization_id, organization.name AS organization_name
         FROM organization_members member
         JOIN organizations organization ON organization.id = member.organization_id
         WHERE member.user_id=$1 AND member.role='owner'`,
        [user.id],
      );
      for (const { organization_id: organizationId, organization_name: organizationName } of owned.rows) {
        const others = await client.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM organization_members WHERE organization_id=$1 AND user_id<>$2",
          [organizationId, user.id],
        );
        if (Number(others.rows[0]?.n ?? 0) > 0) {
          throw new Error(`refusing to remove E2E organization ${organizationId}: it has another member`);
        }
        if (!organizationName.startsWith("E2E Organization ")) {
          throw new Error(`refusing to remove non-E2E organization ${organizationId}`);
        }
        // Organization deletion deliberately RESTRICTs while events exist.
        // Remove this dedicated test workspace's event roots explicitly; all
        // event-scoped rows cascade from them, while organization-scoped rows
        // cascade from the organization in the next statement.
        await client.query("DELETE FROM events WHERE organization_id=$1", [organizationId]);
        await client.query("DELETE FROM organizations WHERE id=$1", [organizationId]);
      }
      await client.query("DELETE FROM users WHERE id=$1", [user.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

test.describe("self-service signup to first value", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.skip(!databaseConfigured(), NO_DATABASE);
  test.skip(!signupJourneyConfigured(), NO_SIGNUP_JOURNEY);

  test("a new customer verifies, provisions, publishes, and receives their first proposal", async ({ page, browser }) => {
    // This is one deliberately continuous customer journey rather than a set
    // of isolated fixtures: it creates and verifies an account, provisions an
    // organization and event, publishes a CFP, then submits through it. Keep
    // the individual 30–60 second UI/delivery limits below as the failure
    // signals; the suite-wide budget only needs to cover their cumulative work.
    test.setTimeout(300_000);
    const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const password = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const personName = `E2E Self-service ${stamp}`;
    const organizationName = `E2E Organization ${stamp}`;
    const eventName = `E2E First Event ${stamp}`;
    const correctedEventName = `${eventName} Updated`;
    const formName = `E2E Call for Speakers ${stamp}`;

    await removePriorTestAccount(SIGNUP_EMAIL);

    await test.step("create an account and activate the verified address", async () => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "Create your workspace", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Create your workspace", exact: true }).click();
      await expect(page).toHaveURL(/\/signup$/);
      const desktopViewport = page.viewportSize();
      await page.setViewportSize({ width: 320, height: 700 });
      const passwordMetrics = await page.locator(".auth-password-input").evaluate((element) => {
        const input = element.querySelector("input");
        const toggle = element.querySelector("button");
        if (!input || !toggle) throw new Error("Signup password control is incomplete");
        const inputBox = input.getBoundingClientRect();
        const toggleBox = toggle.getBoundingClientRect();
        return {
          toggleWidth: toggleBox.width,
          toggleHeight: toggleBox.height,
          verticalCenterDelta: Math.abs((inputBox.top + inputBox.bottom - toggleBox.top - toggleBox.bottom) / 2),
        };
      });
      expect(passwordMetrics.toggleWidth).toBeGreaterThanOrEqual(44);
      expect(passwordMetrics.toggleHeight).toBeGreaterThanOrEqual(44);
      expect(passwordMetrics.verticalCenterDelta).toBeLessThanOrEqual(1);
      if (desktopViewport) await page.setViewportSize(desktopViewport);

      await page.getByLabel("Your name").fill(personName);
      await page.getByLabel("Organization name").fill(organizationName);
      await page.getByLabel("Email address").fill(SIGNUP_EMAIL);
      await page.getByLabel("Password", { exact: true }).fill(password);
      const signupResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/auth/sign-up/email"
        && response.request().method() === "POST");
      await page.getByRole("button", { name: /create account/i }).click();
      const signupResponse = await signupResponsePromise;
      const signupBody = await signupResponse.json().catch(() => null) as unknown;
      expect(signupResponse.ok(), `signup rejected (${signupResponse.status()}): ${JSON.stringify(signupBody)}`).toBe(true);

      await expect(page).toHaveURL(/\/signup\/check-email\?/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
      await expect(page.getByText(SIGNUP_EMAIL, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Email address")).toHaveValue(SIGNUP_EMAIL);
      await expect(page.getByLabel("Email address")).toHaveAttribute("readonly", "");
      await expect(page.getByRole("link", { name: "Start again with the correct address" }))
        .toHaveAttribute("href", "/signup?next=%2Forganizations");

      await page.setViewportSize({ width: 320, height: 700 });
      const inboxCopy = page.getByText(SIGNUP_EMAIL, { exact: true }).locator("..");
      const mobileReadability = await inboxCopy.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          lineHeightRatio: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      expect(mobileReadability.lineHeightRatio).toBeGreaterThanOrEqual(1.4);
      expect(mobileReadability.scrollWidth).toBeLessThanOrEqual(mobileReadability.viewportWidth);
      if (desktopViewport) await page.setViewportSize(desktopViewport);

      if (E2E_FALLBACK_ACTIVATION) {
        const fallback = page.getByRole("link", { name: "Confirm email and continue" });
        await expect(fallback, "the explicit non-production fallback should surface the one-time activation link").toBeVisible();
        await fallback.click();
      } else {
        const delivery = await waitForVerificationDelivery(SIGNUP_EMAIL);
        expect(["delivered", "opened", "clicked"]).toContain(delivery.lastEvent);
        await page.goto(delivery.link);
      }
      await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible({ timeout: 30_000 });
      const sessionsBeforeConfirmation = await queryRows<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM admin_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE lower(u.email) = lower($1)
      `, [SIGNUP_EMAIL]);
      expect(Number(sessionsBeforeConfirmation[0]?.count ?? 0), "following the emailed GET must not create a scanner session").toBe(0);
      await page.getByRole("button", { name: "Confirm and continue" }).click();
      await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/onboarding$/, { timeout: 30_000 });
      await expect(page.getByText(`Welcome to ${organizationName}`)).toBeVisible();
      const onboardingViewport = page.viewportSize();
      await page.setViewportSize({ width: 320, height: 700 });
      expect((await page.getByText("Customize public URL", { exact: true }).boundingBox())?.height)
        .toBeGreaterThanOrEqual(44);
      if (onboardingViewport) await page.setViewportSize(onboardingViewport);
    });

    await test.step("create the first event and tracks", async () => {
      const desktopViewport = page.viewportSize();
      await page.setViewportSize({ width: 600, height: 800 });
      const progress = page.getByRole("list", { name: "Setup progress" });
      for (const label of ["Event details", "Tracks", "First form", "Share"]) {
        await expect(progress.getByText(label, { exact: true })).toBeVisible();
      }
      const progressLayout = await progress.evaluate((element) => ({
        right: element.getBoundingClientRect().right,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(progressLayout.right).toBeLessThanOrEqual(progressLayout.viewportWidth);
      expect(progressLayout.scrollWidth).toBeLessThanOrEqual(progressLayout.viewportWidth);
      if (desktopViewport) await page.setViewportSize(desktopViewport);

      await eventNameInput(page).fill(eventName);
      await eventTimezoneInput(page).selectOption(ONBOARDING_TIMEZONE);
      await expect(eventTimezoneInput(page)).toHaveValue(ONBOARDING_TIMEZONE);
      await expect(eventTimezoneInput(page).locator("option:checked")).toHaveText(/Los Angeles$/);
      await expect(eventTimezoneInput(page).locator("option:checked")).not.toHaveText(ONBOARDING_TIMEZONE);
      await chooseEventDateTime(page, "Starts", 30, "09:00");
      await chooseEventDateTime(page, "Ends", 31, "17:00");
      const createPayloads: unknown[] = [];
      let dropFirstCreateResponse = true;
      await page.route("**/api/internal/organizations/*/onboarding/event", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        createPayloads.push(route.request().postDataJSON());
        if (!dropFirstCreateResponse) return route.continue();
        dropFirstCreateResponse = false;
        const response = await route.fetch();
        expect(response.status(), "the first event create must commit before its response is dropped").toBe(200);
        await route.abort("failed");
      });
      await page.getByRole("button", { name: /^create event/i }).click();

      await expect(page.locator(".field-error")).toHaveText("Creation could not be confirmed.");
      await expect(page.getByRole("button", { name: /retry event creation/i })).toBeVisible();
      await expect(eventNameInput(page)).toBeDisabled();
      await expect(page.getByLabel("Event type")).toBeDisabled();
      await expect(eventTimezoneInput(page)).toBeDisabled();
      await expect(eventDateTimeInput(page, "Starts")).toBeDisabled();
      await expect(eventDateTimeInput(page, "Ends")).toBeDisabled();
      const committedAfterLostResponse = await queryRows<{ id: string }>(`
        SELECT event.id
        FROM events event
        JOIN organizations organization ON organization.id = event.organization_id
        WHERE organization.name = $1 AND event.name = $2
      `, [organizationName, eventName]);
      expect(committedAfterLostResponse, "a lost response must still leave exactly one committed event").toHaveLength(1);

      const recoveredResponse = page.waitForResponse((response) =>
        /\/api\/internal\/organizations\/[0-9a-f-]{36}\/onboarding\/event$/.test(new URL(response.url()).pathname)
        && response.request().method() === "POST");
      await page.getByRole("button", { name: /retry event creation/i }).click();
      expect((await recoveredResponse).status()).toBe(200);
      await page.unroute("**/api/internal/organizations/*/onboarding/event");
      expect(createPayloads).toHaveLength(2);
      expect(createPayloads[1], "the recovery request must preserve its id and every correlation field").toEqual(createPayloads[0]);

      await expect(page.getByRole("heading", { name: "Step 2: Tracks" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Edit event details" }).click();
      await expect(page.getByRole("heading", { name: "Step 1: Event details" })).toBeVisible();
      await expect(eventNameInput(page)).toHaveValue(eventName);
      await eventNameInput(page).fill(correctedEventName);
      const correctedResponse = page.waitForResponse((response) =>
        /\/api\/internal\/events\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname)
        && response.request().method() === "PATCH");
      await page.getByRole("button", { name: "Save and continue" }).click();
      expect((await correctedResponse).status(), "event correction should update the existing event").toBe(200);
      await expect(page.getByRole("heading", { name: "Step 2: Tracks" })).toBeVisible();
      const mainStageSuggestion = page.locator(".onboarding-tracks-step .chip-picker")
        .getByRole("button", { name: "Main Stage", exact: true });
      await mainStageSuggestion.click();
      await expect(page.locator(".onboarding-track-list").getByText("Main Stage", { exact: true })).toBeVisible();
      const createdTrack = await queryRows<{ id: string }>(`
        SELECT id FROM tracks WHERE event_id = (
          SELECT event_id FROM event_onboarding_progress
          WHERE organization_id = (
            SELECT organization_id FROM organization_members om
            JOIN users u ON u.id = om.user_id
            WHERE lower(u.email) = lower($1)
            ORDER BY om.created_at LIMIT 1
          )
          ORDER BY updated_at DESC LIMIT 1
        ) AND name = 'Main Stage'
      `, [SIGNUP_EMAIL]);
      expect(createdTrack).toHaveLength(1);
      await page.getByRole("button", { name: "Remove Main Stage" }).click();
      await expect(page.getByRole("heading", { name: "Remove Main Stage?" })).toBeVisible();
      await page.getByRole("button", { name: "Remove track" }).click();
      await expect(page.locator(".onboarding-track-list").getByText("Main Stage", { exact: true })).toHaveCount(0);
      await mainStageSuggestion.click();
      await expect(page.locator(".onboarding-track-list").getByText("Main Stage", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /^continue/i }).click();
      await expect(page.getByRole("heading", { name: "Step 3: First form" })).toBeVisible();
      await page.getByRole("button", { name: "Back to tracks" }).click();
      await expect(page.getByRole("heading", { name: "Step 2: Tracks" })).toBeVisible();
      await expect(page.locator(".onboarding-track-list").getByText("Main Stage", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /^continue/i }).click();
    });

    let eventId = "";
    let formId = "";
    let publicLink = "";
    await test.step("publish the first form and capture its public link", async () => {
      await expect(page.getByText(/creates a ready-to-use call for speakers form/i)).toBeVisible({ timeout: 30_000 });
      const onboardingViewport = page.viewportSize();
      await page.setViewportSize({ width: 320, height: 700 });
      const publishRow = page.getByText("Publish immediately so the link is shareable right away", { exact: true });
      const publishMetrics = await publishRow.evaluate((element) => {
        const input = element.querySelector("input");
        if (!input) throw new Error("Onboarding publish control is incomplete");
        const rowBox = element.getBoundingClientRect();
        const inputBox = input.getBoundingClientRect();
        return {
          height: rowBox.height,
          verticalCenterDelta: Math.abs((rowBox.top + rowBox.bottom - inputBox.top - inputBox.bottom) / 2),
        };
      });
      expect(publishMetrics.height).toBeGreaterThanOrEqual(44);
      expect(publishMetrics.verticalCenterDelta).toBeLessThanOrEqual(1);
      if (onboardingViewport) await page.setViewportSize(onboardingViewport);

      await page.getByLabel("Form name").fill(formName);
      await expect(page.getByRole("checkbox", { name: /publish immediately/i })).toBeChecked();
      await expect(page.getByLabel("CFP deadline")).toHaveValue("four_weeks");
      await page.getByRole("button", { name: "Create and publish form" }).click();
      const publication = page.getByRole("dialog", { name: `Create and publish “${formName}” now?` });
      await expect(publication).toBeVisible();
      await expect(publication).toContainText("starts accepting speaker submissions");
      await expect(publication).toContainText(/Speakers can create and update submissions until .* P[DS]T/);
      await publication.getByRole("button", { name: "Create and publish form" }).click();

      await expect(page.getByRole("heading", { name: `${correctedEventName} is ready` })).toBeVisible({ timeout: 30_000 });
      const completionViewport = page.viewportSize();
      const completionActions = page.locator(".onboarding-done .cfp-actions");
      await page.setViewportSize({ width: 500, height: 800 });
      const tabletActions = await completionActions.evaluate((element) => {
        const footerBox = element.getBoundingClientRect();
        const actionBoxes = [...element.children].map((action) => action.getBoundingClientRect());
        return {
          actionsFit: actionBoxes.every((box) => box.left >= footerBox.left && box.right <= footerBox.right),
          distinctRows: new Set(actionBoxes.map((box) => Math.round(box.top))).size,
        };
      });
      expect(tabletActions.actionsFit).toBe(true);
      expect(tabletActions.distinctRows).toBe(2);
      await page.setViewportSize({ width: 320, height: 700 });
      const phoneActionRows = await completionActions.locator(":scope > *").evaluateAll((actions) =>
        new Set(actions.map((action) => Math.round(action.getBoundingClientRect().top))).size);
      expect(phoneActionRows).toBe(4);
      if (completionViewport) await page.setViewportSize(completionViewport);

      const linkInput = page.locator(".onboarding-link-row input");
      await expect(linkInput).toBeVisible();
      publicLink = await linkInput.inputValue();
      expect(publicLink).toMatch(/\/submit\/[a-z0-9-]+\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      const restoredResponse = await page.reload();
      await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/onboarding\?event=[0-9a-f-]{36}$/);
      eventId = new URL(page.url()).searchParams.get("event") ?? "";
      formId = new URL(publicLink).pathname.split("/").at(-1) ?? "";
      expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(formId).toMatch(/^[0-9a-f-]{36}$/);
      const publishedForm = await queryRows<{
        closes_at: string | null;
        event_name: string;
        progress_step: string;
        status: string;
      }>(
        `SELECT form.closes_at::text AS closes_at, form.status,
                event.name AS event_name, progress.step AS progress_step
         FROM forms form
         JOIN events event ON event.id = form.event_id
         JOIN event_onboarding_progress progress
           ON progress.event_id = event.id AND progress.form_id = form.id
         WHERE form.id = $1`,
        [formId],
      );
      expect(publishedForm).toHaveLength(1);
      expect(publishedForm[0]?.status).toBe("open");
      expect(publishedForm[0]?.event_name).toBe(correctedEventName);
      expect(publishedForm[0]?.progress_step).toBe("complete");
      expect(publishedForm[0]?.closes_at, "onboarding must not publish an indefinitely open CFP by default").not.toBeNull();
      expect(restoredResponse?.status(), "the completed onboarding checkpoint should restore as a page").toBe(200);
      const restoredHeading = page.getByRole("heading", { name: `${correctedEventName} is ready` });
      await expect(
        restoredHeading,
        `restored onboarding page did not show completion; body: ${(await page.locator("body").innerText()).slice(0, 1_000)}`,
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".onboarding-link-row input")).toHaveValue(publicLink);
      await expect(page.getByRole("link", { name: "Manage form" })).toHaveAttribute("href", /\/events\/[0-9a-f-]{36}\/forms\/[0-9a-f-]{36}$/);

      const previewPromise = page.waitForEvent("popup");
      await page.getByRole("link", { name: "Preview form" }).click();
      const previewPage = await previewPromise;
      await expect(previewPage).toHaveURL(/\/events\/[0-9a-f-]{36}\/forms\/[0-9a-f-]{36}\/preview$/);
      await expect(previewPage.getByText("ORGANIZER PREVIEW", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(previewPage.getByText(/answers stay in this tab and are never saved/i)).toBeVisible();
      await expect(proposalTitleInput(previewPage)).toBeVisible();
      await expect(previewPage.getByRole("button", { name: "Send me a code" })).toHaveCount(0);
      await previewPage.close();

      const liveFormPromise = page.waitForEvent("popup");
      await page.getByRole("link", { name: "Open live form" }).click();
      const liveFormPage = await liveFormPromise;
      await expect(liveFormPage).toHaveURL(publicLink);
      await expect(liveFormPage.getByRole("heading", { name: "Verify your email", level: 2 })).toBeVisible();
      await expect(liveFormPage.getByRole("button", { name: "Send me a code" })).toBeVisible();
      const liveFormViewport = liveFormPage.viewportSize();
      await liveFormPage.setViewportSize({ width: 320, height: 700 });
      const progress = liveFormPage.getByRole("list", { name: "Submission progress" });
      await expect(progress.locator("b")).toHaveText(["Account", "Submission", "Speaker", "Review"]);
      const progressLayout = await progress.evaluate((element) => {
        const items = [...element.querySelectorAll(":scope > li")];
        const measurements = items.map((item) => {
          const label = item.querySelector("b");
          if (!label) throw new Error("Progress item is missing its label");
          return { item: item.getBoundingClientRect(), label: label.getBoundingClientRect() };
        });
        let minLabelGap = Number.POSITIVE_INFINITY;
        measurements.forEach((measurement, index) => {
          if (index === 0) return;
          const previous = measurements.at(index - 1);
          if (previous) minLabelGap = Math.min(minLabelGap, measurement.label.left - previous.label.right);
        });
        return {
          labelsFit: measurements.every(({ item, label }) => label.left >= item.left && label.right <= item.right),
          minLabelGap,
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
      expect(progressLayout.labelsFit).toBe(true);
      expect(progressLayout.minLabelGap).toBeGreaterThanOrEqual(4);
      expect(progressLayout.scrollWidth).toBeLessThanOrEqual(progressLayout.viewportWidth);
      if (liveFormViewport) await liveFormPage.setViewportSize(liveFormViewport);
      await liveFormPage.close();
    });

    const proposalTitle = `E2E First Proposal ${stamp}`;
    let submissionCode = "";
    await test.step("a speaker verifies and submits through the returned CFP", async () => {
      const publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();
      try {
        const response = await publicPage.goto(publicLink);
        expect(response?.status(), `${publicLink} should be public`).toBe(200);
        await expect(publicPage.getByText(correctedEventName, { exact: true })).toBeVisible();
        await expect(publicPage.getByRole("heading", { name: "Welcome!", level: 1 })).toBeVisible();
        await expect(publicPage.getByRole("heading", { name: "Verify your email", level: 2 })).toBeVisible();
        await expect(publicPage.getByLabel("Email address")).toBeVisible();
        await expect(publicPage.getByRole("button", { name: "Send me a code" })).toBeVisible();

        await publicPage.getByLabel("Email address").fill(SIGNUP_EMAIL);
        await publicPage.getByRole("button", { name: "Send me a code" }).click();
        const codeInput = publicPage.getByLabel("Six-digit code");
        await expect(codeInput).toBeVisible({ timeout: 30_000 });
        const otp = E2E_FALLBACK_ACTIVATION
          ? (await publicPage.locator(".demo-code code").textContent())?.trim() ?? ""
          : (await waitForPortalLoginDelivery(eventId, SIGNUP_EMAIL)).otp;
        expect(otp).toMatch(/^\d{6}$/);
        await codeInput.fill(otp);
        await publicPage.getByRole("button", { name: /^continue$/i }).click();

        await expect(proposalTitleInput(publicPage)).toBeVisible({ timeout: 30_000 });
        // New events seed useful session formats, while Tags remains empty
        // until an organizer configures it. The starter CFP should expose the
        // former as an answerable required question and omit the latter.
        const formatInput = publicPage.getByRole("combobox", { name: "Format", exact: true });
        await expect(formatInput).toBeVisible();
        await expect(formatInput.getByRole("option", { name: "Talk", exact: true })).toHaveCount(1);
        await expect(publicPage.getByText("Tags", { exact: true })).toHaveCount(0);
        await proposalTitleInput(publicPage).fill(proposalTitle);
        await publicPage.getByLabel("Description").click();
        await publicPage.keyboard.type("A real proposal proving the first customer loop end to end.");
        await formatInput.selectOption({ label: "Talk" });
        await publicPage.getByRole("combobox", { name: "Track", exact: true }).selectOption({ label: "Main Stage" });
        await publicPage.getByRole("button", { name: /^continue$/i }).click();

        await publicPage.getByLabel("First Name").fill("E2E");
        await publicPage.getByLabel("Last Name").fill("Speaker");
        await publicPage.getByRole("button", { name: /^review$/i }).click();
        await expect(publicPage.getByText(proposalTitle, { exact: true })).toBeVisible();
        await publicPage.getByRole("button", { name: /submit proposal/i }).click();
        await expect(publicPage.getByRole("heading", { name: /your proposal is in/i })).toBeVisible({ timeout: 30_000 });
        submissionCode = (await publicPage.getByText(/SESS-\d+/).textContent())?.trim() ?? "";
        expect(submissionCode).toMatch(/^SESS-\d+$/);
      } finally {
        await publicContext.close();
      }
    });

    await test.step("the organizer sees the first proposal arrive", async () => {
      const submissions = await queryRows<{ id: string; code: number; status: string; submitted_at: Date | null; format_name: string | null }>(`
        SELECT submission.id, submission.code, submission.status, submission.submitted_at, format.name AS format_name
        FROM submissions submission
        LEFT JOIN session_formats format ON format.id = submission.format_id
        WHERE submission.event_id = $1 AND submission.form_id = $2 AND submission.title = $3
      `, [eventId, formId, proposalTitle]);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.status).toBe("pending");
      expect(submissions[0]?.submitted_at).not.toBeNull();
      expect(submissions[0]?.format_name).toBe("Talk");
      expect(`SESS-${submissions[0]?.code}`).toBe(submissionCode);

      await page.goto(`/events/${eventId}/dashboard`);
      await expect(page.getByText("Your first submission arrived", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(proposalTitle, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Get your first submission" })).toHaveCount(0);
    });

    await test.step("the privacy-safe first-value milestones are complete", async () => {
      const milestones = await queryRows<{ milestone: string }>(`
        SELECT milestone
        FROM organization_onboarding_milestones
        WHERE organization_id = (
          SELECT om.organization_id
          FROM organization_members om
          JOIN users u ON u.id = om.user_id
          WHERE lower(u.email) = lower($1)
          ORDER BY om.created_at
          LIMIT 1
        )
        ORDER BY milestone
      `, [SIGNUP_EMAIL]);
      expect(milestones.map((row) => row.milestone)).toEqual([
        "email_verified",
        "event_created",
        "form_published",
        "public_form_visited",
        "signup_completed",
      ]);
    });
  });
});
