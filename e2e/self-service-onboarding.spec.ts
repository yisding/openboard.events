import { expect, test } from "@playwright/test";
import { waitForVerificationDelivery } from "./helpers/admin-auth-mail";
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

  test("a new customer verifies, provisions, publishes, and opens their first CFP", async ({ page, browser }) => {
    test.setTimeout(120_000);
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
      await page.goto("/signup");
      await page.getByLabel("Your name").fill(personName);
      await page.getByLabel("Organization name").fill(organizationName);
      await page.getByLabel("Email address").fill(SIGNUP_EMAIL);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: /create account/i }).click();

      await expect(page).toHaveURL(/\/signup\/check-email\?/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
      await expect(page.getByText(SIGNUP_EMAIL, { exact: true })).toBeVisible();

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
      await page.getByRole("button", { name: /^continue/i }).click();
    });

    let publicLink = "";
    await test.step("publish the first form and capture its public link", async () => {
      await expect(page.getByText(/creates a ready-to-use call for speakers form/i)).toBeVisible({ timeout: 30_000 });
      await page.getByLabel("Form name").fill(formName);
      await expect(page.getByRole("checkbox", { name: /publish immediately/i })).toBeChecked();
      await page.getByRole("button", { name: /^create form/i }).click();

      await expect(page.getByRole("heading", { name: `${eventName} is ready` })).toBeVisible({ timeout: 30_000 });
      const linkInput = page.locator(".onboarding-link-row input");
      await expect(linkInput).toBeVisible();
      publicLink = await linkInput.inputValue();
      expect(publicLink).toMatch(/\/submit\/[a-z0-9-]+\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      await page.reload();
      await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/onboarding\?event=[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { name: `${eventName} is ready` })).toBeVisible();
      await expect(page.locator(".onboarding-link-row input")).toHaveValue(publicLink);
      await expect(page.getByRole("link", { name: "Manage form" })).toHaveAttribute("href", /\/events\/[0-9a-f-]{36}\/forms\/[0-9a-f-]{36}$/);
    });

    await test.step("an unauthenticated visitor can open the returned CFP", async () => {
      const publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();
      try {
        const response = await publicPage.goto(publicLink);
        expect(response?.status(), `${publicLink} should be public`).toBe(200);
        await expect(publicPage.getByRole("heading", { name: "Welcome!", level: 1 })).toBeVisible();
        await expect(publicPage.getByRole("heading", { name: "Verify your email", level: 2 })).toBeVisible();
        await expect(publicPage.getByLabel("Email address")).toBeVisible();
        await expect(publicPage.getByRole("button", { name: "Send me a code" })).toBeVisible();
      } finally {
        await publicContext.close();
      }
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
