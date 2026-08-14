import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, type APIRequestContext, type Cookie, type Page } from "@playwright/test";
import { PORTAL_COOKIE_PREFIX } from "../../src/features/auth/cookies";
import { seededAdminPassword } from "./admin-credentials";
import { USERS } from "./seeded";

/**
 * Admin sign-in through the same Better Auth password endpoint the product UI
 * uses. The credentials stay in the runner environment; there is no deployed
 * test-only session-minting route.
 *
 * Accepts either a `Page` (the browser gets the cookie) or a bare
 * `APIRequestContext` (a separate cookie jar, for the arrange/assert calls a
 * speaker-facing spec makes as an organizer without signing the browser in as
 * one).
 */
export async function loginAsAdmin(target: Page | APIRequestContext, email: string = USERS.organizer): Promise<void> {
  const request = "request" in target ? target.request : target;
  const password = seededAdminPassword(email === USERS.reviewer ? "reviewer" : "organizer");
  const response = await request.post("/api/auth/sign-in", { data: { email, password } });
  if (!response.ok()) {
    const explanation = await response.json()
      .then((body: { error?: { message?: string } }) => body.error?.message ?? "")
      .catch(() => "");
    throw new Error(
      `/api/auth/sign-in returned ${response.status()} for ${email}. `
      + (explanation || "Verify the E2E password matches the bootstrapped account."),
    );
  }
}

/**
 * What a refused login-code request actually means, for the two helpers that
 * have to explain one.
 *
 * There are *two* throttles on this path and the UI cannot tell them apart: it
 * maps any 429 to "Check your inbox, or try again in a few minutes". So neither
 * helper may name one of them as the cause.
 *
 *  - `requestPortalLoginIn` counts un-expired OTPs *per contact*: the fourth
 *    code for one address inside ten minutes is refused. This bucket drains on
 *    its own, so waiting is the fix.
 *  - `POST /api/internal/auth/portal/request` additionally caps 20 requests per
 *    *client IP* per ten minutes (the address-cycling defence). A whole-suite
 *    run issues roughly nine code requests from one runner IP and a
 *    `retries: 1` re-run roughly doubles that, so re-running the suite *spends*
 *    this bucket rather than clearing it.
 */
export const PORTAL_CODE_REFUSAL_CAUSES =
  "Both throttles on this route render the same sentence, so the message does not say which fired: "
  + "three codes per contact per ten minutes (drains on its own — wait it out), and "
  + "twenty code requests per client IP per ten minutes (a full re-run from the same runner spends it "
  + "rather than clearing it — narrow the run, or wait for the window to lapse).";

/**
 * Portal sessions this run has already established, keyed by event + email.
 *
 * Reusing an established session costs one real OTP challenge per speaker
 * instead of one per attempt, which keeps both throttles above out of every
 * result they are not the subject of — the first full run reported "the
 * fallback panel is missing" when it had really spent the per-contact bucket on
 * retries.
 *
 * On disk rather than in a module variable because Playwright retries in a
 * *fresh worker process*, which is exactly when the reuse has to work. It lives
 * in the git-ignored Playwright output directory, and every read is verified
 * against the server — as the right contact — before it is trusted, so a wiped
 * `sb-test` or a rotated session secret just falls back to the real challenge.
 */
const PORTAL_SESSION_FILE = resolve("test-results/.portal-sessions.json");

function readPortalSessions(): Record<string, Cookie[]> {
  try {
    return JSON.parse(readFileSync(PORTAL_SESSION_FILE, "utf8")) as Record<string, Cookie[]>;
  } catch {
    return {};
  }
}

function writePortalSession(key: string, cookies: Cookie[] | null): void {
  const all = readPortalSessions();
  if (cookies) all[key] = cookies; else delete all[key];
  mkdirSync(dirname(PORTAL_SESSION_FILE), { recursive: true });
  writeFileSync(PORTAL_SESSION_FILE, JSON.stringify(all));
}

/**
 * Re-attaches a stored portal session, and proves it is *this speaker's*.
 *
 * "The URL is not /login" is a weaker claim than "this contact is signed in",
 * and the difference is not theoretical: the portal cookie is one per event per
 * BrowserContext (`ob_portal_<eventId>`), so two speakers signed in on two pages
 * of the same context share one slot. A stale or empty entry for speaker B
 * would otherwise be "verified" against speaker A's live session and hand back a
 * silent cross-identity pass — in the very specs whose subject is per-speaker
 * scoping. The signed-in contact's own email is therefore read back from the
 * server and compared; nothing else distinguishes them.
 *
 * `email` arrives already trimmed and lower-cased, matching what the server
 * stores.
 */
async function restorePortalSession(page: Page, eventSlug: string, email: string, cookies: Cookie[]): Promise<boolean> {
  // The event id is only recoverable from the cookie name, and without it there
  // is nothing to check the identity against.
  const portalCookie = cookies.find((cookie) => cookie.name.startsWith(PORTAL_COOKIE_PREFIX));
  const eventId = portalCookie?.name.slice(PORTAL_COOKIE_PREFIX.length);
  if (!eventId) return false;
  await page.context().addCookies(cookies);

  // `page.request` shares this context's cookie jar, so this read is made as
  // whoever the restored cookie says we are — 401 for an expired session, and a
  // different address for somebody else's.
  const profile = await page.request.get(`/api/internal/portal/profile?eventId=${encodeURIComponent(eventId)}`);
  if (!profile.ok()) return false;
  const body = await profile.json().catch(() => null) as { data?: { email?: string } } | null;
  if (body?.data?.email?.trim().toLowerCase() !== email) return false;

  // Middleware bounces a missing cookie and the layout bounces an expired
  // session; both land on the login page. The response status is part of the
  // answer too, so a 5xx or an error page is not mistaken for a live session.
  const response = await page.goto(`/portal/${eventSlug}`);
  return (response?.ok() ?? false) && !new URL(page.url()).pathname.endsWith("/login");
}

/**
 * Speaker sign-in through the *normal* portal challenge — no shortcut route
 * exists, and inventing one would stop testing the path a judge uses. On preview
 * (`EMAIL_FALLBACK_UI=1`, and independently of `EMAIL_MODE`/`EMAIL_ALLOWLIST`:
 * `requestPortalLogin` returns `fallback` for every address) the issued code is
 * rendered in the diagnostics panel; production never renders it.
 */
export async function loginAsSpeaker(page: Page, eventSlug: string, email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  // `|` separates: a slug is `[a-z0-9-]` only, so it cannot collide with the
  // address, and unlike a raw NUL it does not turn this source file into a
  // binary blob that git will not diff and grep will not search.
  const key = `${eventSlug}|${address}`;
  const stored = readPortalSessions()[key];
  // `stored?.length`, not `stored`: an empty array is truthy, and taking the
  // restore path with no cookies to attach validates whatever session the
  // context already holds.
  if (stored?.length && await restorePortalSession(page, eventSlug, address, stored)) return;
  if (stored) writePortalSession(key, null);

  await page.goto(`/portal/${eventSlug}/login`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: /send|continue|sign in/i }).click();

  // The form answers with either the fallback panel or an inline error, and a
  // throttle has to be named: waiting 30 s for a panel that will never appear
  // reports the wrong failure.
  const code = page.locator(".demo-code code");
  const failure = page.locator(".field-error");
  const answered = async () => (await code.count()) > 0 ? "issued" : (await failure.count()) > 0 ? "refused" : "pending";
  await expect
    .poll(answered, { message: "the login form should answer the code request", timeout: 20_000 })
    .not.toEqual("pending");
  if (await answered() === "refused") {
    throw new Error(
      `/api/internal/auth/portal/request refused a code for ${email}: "${(await failure.first().innerText()).trim()}". `
      + PORTAL_CODE_REFUSAL_CAUSES,
    );
  }

  const otp = (await code.first().textContent())?.trim() ?? "";
  expect(otp, "an OTP should have been issued").not.toEqual("");

  await page.getByLabel(/code/i).fill(otp);
  await page.getByRole("button", { name: /verify|sign in|continue/i }).click();
  await expect(page).toHaveURL(new RegExp(`/portal/${eventSlug}(?!/login)`));

  writePortalSession(key, (await page.context().cookies()).filter((cookie) => cookie.name.startsWith(PORTAL_COOKIE_PREFIX)));
}

/**
 * The `{ data }` envelope every internal route answers with, unwrapped once so a
 * spec asserting on a payload does not re-implement the error handling.
 */
export async function apiData<T>(
  request: APIRequestContext,
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; data?: unknown } = {},
): Promise<T> {
  const response = await request.fetch(path, {
    method: init.method ?? "GET",
    ...(init.data === undefined ? {} : { data: init.data }),
  });
  const body = await response.json().catch(() => null) as { data?: T; error?: { code?: string; message?: string } } | null;
  if (!response.ok() || body?.data === undefined) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status()} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim());
  }
  return body.data;
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
