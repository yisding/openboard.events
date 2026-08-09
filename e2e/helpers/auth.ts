import { expect, type Page } from "@playwright/test";
import { USERS } from "./seeded";

/**
 * Admin sign-in for specs. `/api/test/login` 404s unless `TEST_AUTH=1` at build
 * time, so it exists on preview and cannot exist in production. There is no
 * seeded bearer token: this is the only machine path into an admin session.
 */
export async function loginAsAdmin(page: Page, email: string = USERS.organizer): Promise<void> {
  const response = await page.request.post("/api/test/login", { data: { email } });
  if (!response.ok()) {
    throw new Error(
      `/api/test/login returned ${response.status()} for ${email}. `
      + "Deploy the preview with TEST_AUTH=1 and seed the user, or the spec has nothing to sign in as.",
    );
  }
}

/**
 * Speaker sign-in through the *normal* portal challenge — no shortcut route
 * exists, and inventing one would stop testing the path a judge uses. On preview
 * (`EMAIL_FALLBACK_UI=1`) the issued code is rendered in the diagnostics panel;
 * production never renders it.
 */
export async function loginAsSpeaker(page: Page, eventSlug: string, email: string): Promise<void> {
  await page.goto(`/portal/${eventSlug}/login`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: /send|continue|sign in/i }).click();

  const code = page.locator(".demo-code code");
  await expect(code, "the preview fallback panel should render the issued code").toBeVisible();
  const otp = (await code.textContent())?.trim() ?? "";
  expect(otp, "an OTP should have been issued").not.toEqual("");

  await page.getByLabel(/code/i).fill(otp);
  await page.getByRole("button", { name: /verify|sign in|continue/i }).click();
  await expect(page).toHaveURL(new RegExp(`/portal/${eventSlug}(?!/login)`));
}

/**
 * Fails the test on any console error the page logged. An uncaught render error
 * is a judged failure that a passing assertion happily walks past.
 */
export function expectNoConsoleErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "the page logged console errors").toEqual([]);
}
