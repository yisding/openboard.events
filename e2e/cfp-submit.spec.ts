import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin, PORTAL_CODE_REFUSAL_CAUSES } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, FORMS, uniqueEmail } from "./helpers/seeded";

/**
 * The spine. Goes green when M15 (wizard), M16 (pipeline) and M06b (portal auth)
 * land — target CP2, owned by WS-B2. This spec passing *is* the definition of
 * "the golden path is green": never soften an assertion here to pass a
 * checkpoint.
 */

const FORM_PATH = `/submit/${EVENTS.main.slug}/${FORMS.open.id}`;
const COUNTS_PATH = `/api/internal/submissions/${EVENTS.main.id}/counts`;

type AnswerMap = Record<string, { t: string; v: unknown }>;
type StatusCounts = Record<string, number>;

/**
 * A dropdown question, by its accessible name rather than by `getByLabel`.
 *
 * `getByLabel` matches on a substring by default, and the description field's
 * rich-text editor puts a `role="toolbar" aria-label="Formatting"` on the same
 * step — so `getByLabel("Format")` resolves to two elements and every wizard
 * spec dies in strict mode. Both names are the app's to choose; addressing the
 * `<select>` by role and exact name is the spec's job.
 */
function dropdown(page: Page, name: string): Locator {
  return page.getByRole("combobox", { name, exact: true });
}

/**
 * The account step, through the real OTP challenge — there is no shortcut into
 * a portal session and inventing one would stop testing the path a judge uses.
 * Returns once the submission step is on screen.
 *
 * This is the suite's highest-traffic login path (six calls a run), so it gets
 * the same refusal handling `loginAsSpeaker` has: a refused code request leaves
 * `codeRequested` false, so the OTP input and the fallback panel never render
 * and the step reports itself only through `.cfp-notice`. Waiting on the panel
 * alone would time out blaming `EMAIL_FALLBACK_UI` for what is really a
 * throttle — the wrong env knob, on the wrong machine, for half an hour.
 */
async function signInAtAccountStep(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: /send me a code/i }).click();

  const issued = page.locator(".demo-code code");
  const otpInput = page.getByLabel(/six-digit code/i);
  const notice = page.locator(".cfp-notice");
  // A successful request renders the notice *and* the OTP input in the same
  // commit, so "a notice with no input" is unambiguously the refusal.
  const answered = async () => (await issued.count()) > 0
    ? "issued"
    : (await notice.count()) > 0 && (await otpInput.count()) === 0 ? "refused" : "pending";
  await expect
    .poll(answered, { message: "the account step should answer the code request", timeout: 20_000 })
    .not.toEqual("pending");
  if (await answered() === "refused") {
    throw new Error(
      `the account step could not get a code for ${email}: "${(await notice.first().innerText()).trim()}". `
      + PORTAL_CODE_REFUSAL_CAUSES,
    );
  }

  await expect(issued, "preview renders the issued code (EMAIL_FALLBACK_UI=1); production never does").toBeVisible();
  await otpInput.fill((await issued.textContent())?.trim() ?? "");
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByLabel("Title")).toBeVisible();
}

/** Everything the seeded form A requires, keyed by the pinned snapshot's field ids. */
function abstractAnswers(title: string): AnswerMap {
  return {
    [FORMS.open.fields.title]: { t: "s", v: title },
    [FORMS.open.fields.description]: { t: "s", v: `<p>${title}</p>` },
    [FORMS.open.fields.track]: { t: "opt", v: "platforms" },
    [FORMS.open.fields.format]: { t: "opt", v: "talk" },
  };
}

function participantAnswers(email: string): AnswerMap {
  return {
    [FORMS.open.fields.firstName]: { t: "s", v: "E2E" },
    [FORMS.open.fields.lastName]: { t: "s", v: "Speaker" },
    [FORMS.open.fields.email]: { t: "s", v: email },
  };
}

/**
 * A submit through the real endpoint on an already-established portal session.
 * Used only to *reach* the seeded limit — the assertion that matters is made
 * through the wizard afterwards.
 */
async function submitThroughApi(request: APIRequestContext, email: string, title: string) {
  return request.post(`/api/internal/forms/${FORMS.open.id}/submit`, {
    data: {
      formVersion: FORMS.open.version,
      answers: abstractAnswers(title),
      participants: [{
        clientId: "primary",
        email,
        role: "speaker",
        isPrimary: true,
        sortOrder: 0,
        answers: participantAnswers(email),
      }],
    },
  });
}

test.describe("cfp-submit", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("the wizard end to end", () => {
    test.skip(!landed("M15", "M16"), waitingOn("M15", "M16"));

    test("a speaker submits through the public wizard", async ({ page, request }) => {
      const assertClean = expectNoConsoleErrors(page);
      const email = uniqueEmail("wizard");
      const title = `E2E golden path ${Date.now()}`;
      // A second cookie jar: the organizer's reads must not sign the speaker's
      // browser in as an admin.
      await loginAsAdmin(request);
      const draftsBefore = (await apiData<StatusCounts>(request, COUNTS_PATH)).draft ?? 0;

      await page.goto(FORM_PATH);

      await test.step("welcome shows the deadline in event tz, with its zone label", async () => {
        // A spec that matches only the date passes while the banner shows a judge
        // in another zone the wrong hour. Assert the label ("11:59 PM PDT").
        expect(EVENTS.main.timezone).toBe("America/Los_Angeles");
        const deadline = page.locator(".welcome-facts dd").first();
        await expect(deadline).toHaveText(/11:59 PM P[DS]T$/);
      });

      await test.step(`the submission limit banner reads ${FORMS.open.limit}`, async () => {
        await expect(page.getByText(`${FORMS.open.limit} per speaker`)).toBeVisible();
      });

      await test.step("the account step takes an email and its OTP from the fallback panel", async () => {
        await signInAtAccountStep(page, email);
      });

      await test.step("a server draft row now exists", async () => {
        // Counted through the admin Drafts tab's own endpoint. This is what
        // separates a real server draft from localStorage: another session,
        // authenticated as somebody else, can see it.
        await expect.poll(
          async () => (await apiData<StatusCounts>(request, COUNTS_PATH)).draft ?? 0,
          { message: "the account step should have created a server draft", timeout: 20_000 },
        ).toBeGreaterThan(draftsBefore);
      });

      await test.step(`the conditional field appears only when Format = ${FORMS.open.conditionalOn}`, async () => {
        await expect(page.getByLabel(FORMS.open.conditionalField)).toHaveCount(0);
        await dropdown(page, "Format").selectOption({ label: FORMS.open.conditionalOn });
        await expect(page.getByLabel(FORMS.open.conditionalField)).toBeVisible();
      });

      await test.step("a hidden answer is not submitted", async () => {
        // Answer it, then switch the format back: the stale answer must be gone,
        // not merely invisible.
        await page.getByLabel(FORMS.open.conditionalField).fill("90 minutes, hands on");
        await dropdown(page, "Format").selectOption({ label: "Talk" });
        await expect(page.getByLabel(FORMS.open.conditionalField)).toHaveCount(0);
      });

      await test.step("participant, review and submit reach the success page", async () => {
        await page.getByLabel("Title").fill(title);
        await dropdown(page, "Track").selectOption({ label: "Platforms" });
        await page.getByRole("textbox", { name: "Description", exact: true }).click();
        await page.keyboard.type("Everything we learned shipping this.");
        await page.getByRole("button", { name: /^continue$/i }).click();

        await page.getByLabel("First name").fill("E2E");
        await page.getByLabel("Last name").fill("Speaker");
        await page.getByRole("button", { name: /^review$/i }).click();

        // The review read-back is where a stale hidden answer would be
        // conspicuous, so it is checked here rather than trusted.
        await expect(page.getByText(title)).toBeVisible();
        await expect(page.getByText("90 minutes, hands on")).toHaveCount(0);

        await page.getByRole("button", { name: /submit proposal/i }).click();
        await expect(page.getByRole("heading", { name: /your proposal is in/i })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/SESS-\d+/)).toBeVisible();
      });

      await test.step("the stored answers carry no value for the hidden field", async () => {
        // The read-back proves what the speaker saw; this proves what landed.
        // `stripHiddenAnswers` runs server-side, and only the row can say so.
        const list = await apiData<{ rows: Array<{ submissionId: string }> }>(
          request,
          `/api/internal/submissions/${EVENTS.main.id}?status=all&search=${encodeURIComponent(title)}`,
        );
        expect(list.rows.length, "the submitted abstract should be findable by its title").toBe(1);
        const submissionId = list.rows[0]?.submissionId ?? "";
        const detail = await apiData<{ answerPanel: { answers: Array<{ fieldId: string }> } }>(
          request,
          `/api/internal/submissions/${EVENTS.main.id}/${submissionId}`,
        );
        const answered = detail.answerPanel.answers.map((answer) => answer.fieldId);
        expect(answered).toContain(FORMS.open.fields.title);
        expect(answered).not.toContain(FORMS.open.fields.workshopDuration);
      });

      assertClean();
    });

    test("past the limit, the friendly block is shown", async ({ page }) => {
      const email = uniqueEmail("limit");
      await page.goto(FORM_PATH);
      await signInAtAccountStep(page, email);

      await test.step(`reaching the seeded limit of ${FORMS.open.limit}`, async () => {
        // Through the real endpoint on the session the wizard just established:
        // three UI round trips would prove nothing this does not.
        for (let index = 0; index < FORMS.open.limit; index += 1) {
          const response = await submitThroughApi(page.request, email, `E2E limit filler ${index} ${Date.now()}`);
          expect(response.status(), "a submit inside the limit must succeed").toBe(200);
        }
        // The first filler promoted the draft the account step had just created
        // (`createSubmission` promotes any open draft for this speaker+form), so
        // the wizard is still holding a `draftSubmissionId` that is now
        // committed. Submitting on it is a *retry* of that filler by the
        // server's own idempotency rule — `submitCfpForm` replays the committed
        // result before it ever reaches the limit check, and the speaker would
        // see the filler's SESS code as a success. Restarting the wizard gives
        // it a fresh draft, which is what a speaker starting a fourth proposal
        // actually has.
        await page.goto(FORM_PATH);
        await signInAtAccountStep(page, email);
      });

      await test.step("a fourth submit past the seeded limit shows LIMIT_REACHED, not a 500", async () => {
        await page.getByLabel("Title").fill(`E2E over the limit ${Date.now()}`);
        await dropdown(page, "Track").selectOption({ label: "Platforms" });
        await dropdown(page, "Format").selectOption({ label: "Talk" });
        await page.getByRole("textbox", { name: "Description", exact: true }).click();
        await page.keyboard.type("One more than allowed.");
        await page.getByRole("button", { name: /^continue$/i }).click();
        await page.getByLabel("First name").fill("E2E");
        await page.getByLabel("Last name").fill("Speaker");
        await page.getByRole("button", { name: /^review$/i }).click();
        await page.getByRole("button", { name: /submit proposal/i }).click();

        // The typed error, rendered as a sentence — not a stack trace, and not
        // an optimistic success page.
        const notice = page.locator(".cfp-notice");
        await expect(notice).toBeVisible();
        await expect(notice).toHaveText(new RegExp(`limit of ${FORMS.open.limit}`, "i"));
        await expect(page.getByRole("heading", { name: /your proposal is in/i })).toHaveCount(0);
      });
    });
  });

  test.describe("wizard state", () => {
    test.skip(!landed("M15", "M16"), waitingOn("M15", "M16"));

    test("a reload mid-wizard keeps the answers", async ({ page }) => {
      const email = uniqueEmail("reload");
      const title = `E2E survives a reload ${Date.now()}`;

      await test.step("answers survive a reload", async () => {
        // Note the deviation from the M10 work order's wording: the merged
        // wizard persists answers as a *server draft* (M16's `upsertDraft`),
        // not in Zustand/localStorage. That is the stronger property — the
        // answers survive a different browser, not just a reload — so this
        // asserts the behaviour that exists rather than the mechanism that
        // was planned. The gate for this step is M15+M16 for that reason.
        await page.goto(FORM_PATH);
        await signInAtAccountStep(page, email);
        await page.getByLabel("Title").fill(title);
        // The autosave debounce is 800 ms and the indicator is the only signal
        // that the PATCH landed; waiting on it beats sleeping.
        await expect(page.locator(".autosave")).toHaveText(/saved/i, { timeout: 20_000 });

        await page.reload();
        await signInAtAccountStep(page, email);
        await expect(page.getByLabel("Title")).toHaveValue(title);
      });
    });
  });

  test.describe("the closed form", () => {
    test.skip(!landed("M09", "M15"), waitingOn("M09", "M15"));

    test("the closed form renders the branded closed page", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await test.step(`form ${FORMS.closed.key} renders closed, with branding intact`, async () => {
        await page.goto(`/submit/${EVENTS.main.slug}/${FORMS.closed.id}`);
        // Closed by date, not by an admin switch: the page must say when, in the
        // event's zone, and it must still look like this event's page.
        await expect(page.locator("main.cfp-closed")).toBeVisible();
        await expect(page.getByText(/submissions closed/i)).toBeVisible();
        await expect(page.getByText(/11:59 PM P[DS]T/)).toBeVisible();
        await expect(page.getByText(EVENTS.main.name)).toBeVisible();
        await expect(page.getByRole("link", { name: /see the programme/i })).toBeVisible();
        // And no form: a closed form that still renders its questions is worse
        // than one that 404s.
        await expect(page.getByLabel("Email address")).toHaveCount(0);
      });
      assertClean();
    });
  });
});

/** The brief's judge submits from a phone; this runs the same path at 390px. */
test.describe("cfp-submit on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(!targetConfigured(), NO_TARGET);
  test.skip(!landed("M15", "M16"), waitingOn("M15", "M16"));

  test("the wizard is usable at 390px", async ({ page }) => {
    const assertClean = expectNoConsoleErrors(page);
    const email = uniqueEmail("phone");

    await test.step("no horizontal scroll, and every step is reachable", async () => {
      await page.goto(FORM_PATH);
      const overflows = async () => page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(await overflows(), "the welcome screen must not scroll sideways at 390px").toBe(false);

      await signInAtAccountStep(page, email);
      expect(await overflows(), "the submission step must not scroll sideways at 390px").toBe(false);

      await page.getByLabel("Title").fill(`E2E phone ${Date.now()}`);
      await dropdown(page, "Track").selectOption({ label: "Platforms" });
      await dropdown(page, "Format").selectOption({ label: "Talk" });
      await page.getByRole("textbox", { name: "Description", exact: true }).click();
      await page.keyboard.type("Submitted from a phone.");
      await page.getByRole("button", { name: /^continue$/i }).click();

      await page.getByLabel("First name").fill("E2E");
      await page.getByLabel("Last name").fill("Speaker");
      expect(await overflows(), "the speaker step must not scroll sideways at 390px").toBe(false);
      await page.getByRole("button", { name: /^review$/i }).click();

      await expect(page.getByRole("button", { name: /submit proposal/i })).toBeVisible();
      expect(await overflows(), "the review step must not scroll sideways at 390px").toBe(false);
    });

    assertClean();
  });
});
