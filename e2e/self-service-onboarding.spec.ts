import { expect, test } from "@playwright/test";
import { waitForPortalLoginDelivery, waitForVerificationDelivery } from "./helpers/admin-auth-mail";
import { queryRows, withDatabase } from "./helpers/db";
import {
  BASE_URL,
  databaseConfigured,
  E2E_FALLBACK_ACTIVATION,
  NO_DATABASE,
  NO_SIGNUP_MAILBOX,
  NO_TARGET,
  SIGNUP_EMAIL,
  signupMailboxConfigured,
  targetConfigured,
} from "./helpers/env";

function localInput(daysFromNow: number, time: string): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T${time}`;
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
      const owned = await client.query<{ organization_id: string }>(
        "SELECT organization_id FROM organization_members WHERE user_id=$1 AND role='owner'",
        [user.id],
      );
      for (const { organization_id: organizationId } of owned.rows) {
        const others = await client.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM organization_members WHERE organization_id=$1 AND user_id<>$2",
          [organizationId, user.id],
        );
        if (Number(others.rows[0]?.n ?? 0) > 0) {
          throw new Error(`refusing to remove E2E organization ${organizationId}: it has another member`);
        }
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
  test.skip(!signupMailboxConfigured(), NO_SIGNUP_MAILBOX);

  test("a new customer verifies, provisions, publishes, and receives their first proposal", async ({ page, browser }) => {
    test.setTimeout(180_000);
    if (E2E_FALLBACK_ACTIVATION && !["localhost", "127.0.0.1"].includes(new URL(BASE_URL).hostname)) {
      throw new Error("E2E_FALLBACK_ACTIVATION is local-only; deployed proof must retrieve the delivered Resend message");
    }
    const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const password = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const personName = `E2E Self-service ${stamp}`;
    const organizationName = `E2E Organization ${stamp}`;
    const eventName = `E2E First Event ${stamp}`;
    const formName = `E2E Call for Speakers ${stamp}`;

    await removePriorTestAccount(SIGNUP_EMAIL);

    await test.step("create an account and receive a real verification message", async () => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "Create your workspace", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Create your workspace", exact: true }).click();
      await expect(page).toHaveURL(/\/signup$/);
      await page.getByLabel("Your name").fill(personName);
      await page.getByLabel("Organization name").fill(organizationName);
      await page.getByLabel("Email address").fill(SIGNUP_EMAIL);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: /create account/i }).click();

      await expect(page).toHaveURL(/\/signup\/check-email\?/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
      await expect(page.getByText(SIGNUP_EMAIL, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Email address")).toHaveValue(SIGNUP_EMAIL);
      await expect(page.getByLabel("Email address")).toHaveAttribute("readonly", "");
      await expect(page.getByRole("link", { name: "Start again with the correct address" })).toHaveAttribute("href", "/signup");

      if (E2E_FALLBACK_ACTIVATION) {
        const fallback = page.getByRole("link", { name: "Open confirmation link" });
        await expect(fallback, "local fallback activation must never be enabled on preview or production").toBeVisible();
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
    });

    await test.step("create the first event and tracks", async () => {
      await page.getByLabel("Event name").fill(eventName);
      await page.getByLabel("Starts").fill(localInput(30, "09:00"));
      await page.getByLabel("Ends").fill(localInput(31, "17:00"));
      await page.getByRole("button", { name: /^create event/i }).click();

      await expect(page.getByRole("heading", { name: "Step 2: Tracks" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: /main stage/i }).click();
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
      await page.getByRole("button", { name: /main stage/i }).click();
      await expect(page.locator(".onboarding-track-list").getByText("Main Stage", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /^continue/i }).click();
    });

    let eventId = "";
    let formId = "";
    let publicLink = "";
    await test.step("publish the first form and capture its public link", async () => {
      await expect(page.getByText(/creates a ready-to-use call for speakers form/i)).toBeVisible({ timeout: 30_000 });
      await page.getByLabel("Form name").fill(formName);
      await expect(page.getByRole("checkbox", { name: /publish immediately/i })).toBeChecked();
      await expect(page.getByLabel("CFP deadline")).toHaveValue("four_weeks");
      await page.getByRole("button", { name: /^create form/i }).click();

      await expect(page.getByRole("heading", { name: `${eventName} is ready` })).toBeVisible({ timeout: 30_000 });
      const linkInput = page.locator(".onboarding-link-row input");
      await expect(linkInput).toBeVisible();
      publicLink = await linkInput.inputValue();
      expect(publicLink).toMatch(/\/submit\/[a-z0-9-]+\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      await page.reload();
      await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/onboarding\?event=[0-9a-f-]{36}$/);
      eventId = new URL(page.url()).searchParams.get("event") ?? "";
      formId = new URL(publicLink).pathname.split("/").at(-1) ?? "";
      expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(formId).toMatch(/^[0-9a-f-]{36}$/);
      const publishedForm = await queryRows<{ closes_at: string | null; status: string }>(
        "SELECT closes_at::text AS closes_at, status FROM forms WHERE id = $1",
        [formId],
      );
      expect(publishedForm).toHaveLength(1);
      expect(publishedForm[0]?.status).toBe("open");
      expect(publishedForm[0]?.closes_at, "onboarding must not publish an indefinitely open CFP by default").not.toBeNull();
      await expect(page.getByRole("heading", { name: `${eventName} is ready` })).toBeVisible();
      await expect(page.locator(".onboarding-link-row input")).toHaveValue(publicLink);
      await expect(page.getByRole("link", { name: "Manage form" })).toHaveAttribute("href", /\/events\/[0-9a-f-]{36}\/forms\/[0-9a-f-]{36}$/);

      const previewPromise = page.waitForEvent("popup");
      await page.getByRole("link", { name: "Preview form" }).click();
      const previewPage = await previewPromise;
      await expect(previewPage).toHaveURL(/\/events\/[0-9a-f-]{36}\/forms\/[0-9a-f-]{36}\/preview$/);
      await expect(previewPage.getByText("ORGANIZER PREVIEW", { exact: true })).toBeVisible();
      await expect(previewPage.getByText(/answers stay in this tab and are never saved/i)).toBeVisible();
      await expect(previewPage.getByLabel("Title")).toBeVisible();
      await expect(previewPage.getByRole("button", { name: "Send me a code" })).toHaveCount(0);
      await previewPage.close();
    });

    const proposalTitle = `E2E First Proposal ${stamp}`;
    let submissionCode = "";
    await test.step("a speaker verifies and submits through the returned CFP", async () => {
      const publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();
      try {
        const response = await publicPage.goto(publicLink);
        expect(response?.status(), `${publicLink} should be public`).toBe(200);
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

        await expect(publicPage.getByLabel("Title")).toBeVisible({ timeout: 30_000 });
        // The generated form retains empty vocabulary questions in its
        // authoring model so an organizer can configure them later, but the
        // actual proposal step must not show Format/Tags with no choices.
        await expect(publicPage.getByRole("combobox", { name: "Format", exact: true })).toHaveCount(0);
        await expect(publicPage.getByText("Tags", { exact: true })).toHaveCount(0);
        await publicPage.getByLabel("Title").fill(proposalTitle);
        await publicPage.getByLabel("Description").click();
        await publicPage.keyboard.type("A real proposal proving the first customer loop end to end.");
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
      const submissions = await queryRows<{ id: string; code: number; status: string }>(`
        SELECT id, code, status
        FROM submissions
        WHERE event_id = $1 AND form_id = $2 AND title = $3
      `, [eventId, formId, proposalTitle]);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.status).toBe("submitted");
      expect(`SESS-${submissions[0]?.code}`).toBe(submissionCode);

      await page.goto(`/events/${eventId}/dashboard`);
      await expect(page.getByText("Your first submission arrived", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(proposalTitle, { exact: false })).toBeVisible();
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
