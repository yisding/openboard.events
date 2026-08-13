import { expect, test } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { EVENTS, EVENT_EDITABLE_TEMPLATE_KEYS_PER_EVENT, TEMPLATE_KEYS_PER_EVENT } from "./helpers/seeded";

/**
 * Covers seeded sign-in, event setup, empty states, and the form builder
 * against the deployed preview.
 */

/** Unique per run: the suite wipes and reseeds, but a retry inside one run must not collide. */
function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Event-local wall clock, typed the way an organizer types it into `<input type="datetime-local">`. */
function localInput(daysFromNow: number, time: string): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T${time}`;
}

type BuilderField = { id: string; label: string; fieldType: string; visibility: unknown };
type BuilderForm = { id: string; status: string; sections: Array<{ key: string; fields: BuilderField[] }> };

test.describe("admin-setup", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test.describe("against the seeded world", () => {
    test("an organizer signs in and reaches the seeded event", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await test.step("sign in as the seeded organizer", async () => {
        await loginAsAdmin(page);
      });
      await test.step("the events list shows the seeded event", async () => {
        await page.goto("/events");
        // By heading, not by text: the card repeats the name in its cover strip,
        // and a bare text match resolves to two nodes.
        await expect(page.getByRole("heading", { name: EVENTS.main.name })).toBeVisible();
        await expect(page.getByRole("heading", { name: EVENTS.empty.name })).toBeVisible();
        await expect(page.getByText(`/${EVENTS.main.slug}`)).toBeVisible();
      });
      assertClean();
    });
  });

  test.describe("event creation", () => {
    test("guided event creation validates, provisions defaults, and finishes setup", async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/events/new");
      await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/onboarding/);
      const detailsToggle = page.getByText("Customize public URL", { exact: true });
      const tracksHeading = page.getByRole("heading", { name: "Step 2: Tracks" });
      const formHeading = page.getByRole("heading", { name: "Step 3: First form" });
      let eventId = "";

      // Playwright retries in a new worker without wiping the shared test
      // database again. If the first attempt committed step 1 before a later
      // transient failure, the durable wizard correctly resumes at Tracks or
      // First form; the test must resume too instead of waiting for step 1.
      if (await detailsToggle.isVisible()) {
        await detailsToggle.click();

        await test.step("an end before the start is refused inline", async () => {
          // The form must reject it, not the database, and the message must appear
          // next to the field. The earlier deviation note here — that `api()`
          // dropped the zod `fieldErrors` map, so the page could only show the
          // envelope's "Request validation failed" — no longer holds: the client
          // carries the map and the form renders one message, under the offending
          // input, instead of a summary paragraph as well. So the real wording is
          // asserted, and `.field-error` resolving to a single node is part of the
          // claim rather than an accident.
          await page.getByLabel("Event name").fill("E2E backwards dates");
          await page.getByLabel("Event slug").fill(uniqueSlug("e2e-backwards"));
          await page.getByLabel("Starts", { exact: true }).fill(localInput(30, "09:00"));
          await page.getByLabel("Ends", { exact: true }).fill(localInput(30, "08:00"));
          await page.getByRole("button", { name: /create event/i }).click();
          await expect(page.locator(".field-error")).toHaveText(/ends at must be after starts at/i);
          await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/onboarding/);
        });

        await test.step("a reserved slug is refused", async () => {
          // `api` must not become an event slug — it would shadow the API routes.
          await page.getByLabel("Event slug").fill("api");
          await page.getByLabel("Ends", { exact: true }).fill(localInput(31, "17:00"));
          await page.getByRole("button", { name: /create event/i }).click();
          await expect(page.locator(".field-error")).toHaveText(/reserved word/i);
          await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}\/onboarding/);
        });
      } else {
        await test.step("a retry resumes the durable onboarding checkpoint", async () => {
          await expect(tracksHeading.or(formHeading)).toBeVisible();
          const events = await apiData<Array<{ id: string; name: string }>>(page.request, "/api/internal/events");
          const resumed = events.filter((event) => event.name === "E2E created event");
          expect(resumed, "the resumed checkpoint should identify one event from the prior attempt").toHaveLength(1);
          eventId = resumed[0]?.id ?? "";
        });
      }

      await test.step("the guided create finishes and seeds every event-editable email template", async () => {
        // 7 domain keys + portal_login + M50's two review keys + M51's
        // speaker_bulk_message + M42's two admin keys + M44's
        // organization_invited. This is what proves M11 called
        // seedDefaultTemplates rather than creating the event bare.
        expect(TEMPLATE_KEYS_PER_EVENT).toBe(14);
        if (!eventId) {
          const slug = uniqueSlug("e2e-event");
          await page.getByLabel("Event name").fill("E2E created event");
          await page.getByLabel("Event slug").fill(slug);
          const createdResponse = page.waitForResponse((response) =>
            response.url().includes("/api/internal/organizations/")
            && response.url().endsWith("/onboarding/event")
            && response.request().method() === "POST");
          await page.getByRole("button", { name: /create event/i }).click();
          const created = await createdResponse;
          expect(created.status(), "guided event creation should succeed").toBe(200);
          const createdBody = await created.json() as { data?: { id?: string } };
          eventId = createdBody.data?.id ?? "";
        }
        expect(eventId, "the guided create should return the new event id").toMatch(/^[0-9a-f-]{36}$/);

        if (await tracksHeading.isVisible()) {
          await page.getByRole("button", { name: "Skip for now" }).click();
        }
        await expect(formHeading).toBeVisible({ timeout: 30_000 });
        await page.getByRole("button", { name: "Create and publish form" }).click();
        const publication = page.getByRole("dialog", { name: "Create and publish “Call for Speakers” now?" });
        await expect(publication).toContainText("starts accepting speaker submissions");
        await publication.getByRole("button", { name: "Create and publish form" }).click();
        await expect(page.getByRole("heading", { name: "E2E created event is ready" })).toBeVisible({ timeout: 30_000 });

        // Communications exposes event mail only. The two platform-auth
        // templates and the team invitation are seeded too, but intentionally
        // have no event-level controls because they may be sent before an
        // event exists.
        await page.goto(`/events/${eventId}/communications?tab=templates`);
        await expect(page.locator("nav[aria-label='Template keys'] button")).toHaveCount(EVENT_EDITABLE_TEMPLATE_KEYS_PER_EVENT);
        // And the same count from the route the rail reads, so a rail that
        // invents controls for platform mail (or omits event mail) cannot pass.
        const templates = await apiData<Array<{ key: string }>>(page.request, `/api/internal/comms/${eventId}/templates`);
        expect(templates).toHaveLength(EVENT_EDITABLE_TEMPLATE_KEYS_PER_EVENT);
        expect(templates.map((template) => template.key)).toContain("portal_login");
        expect(templates.map((template) => template.key)).not.toContain("admin_password_reset");
      });
    });

    test("the empty event renders empty states, not a crash", async ({ page }) => {
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      await test.step(`${EVENTS.empty.name} renders its designed empty state`, async () => {
        // The standing empty-state test: it must stay genuinely empty, and every
        // surface must render its designed empty state rather than crash.
        await page.goto(`/events/${EVENTS.empty.id}/settings?tab=tracks`);
        // `exact`, because the empty state's own heading is "No tracks yet" and
        // an accessible-name match is a substring match: the panel heading and
        // the empty state it is asserting the presence of matched the same
        // locator, and two matches is a strict-mode failure rather than a pass.
        await expect(page.getByRole("heading", { name: "Tracks", exact: true })).toBeVisible();
        await expect(page.getByText("No tracks yet")).toBeVisible();

        await page.goto(`/events/${EVENTS.empty.id}/forms`);
        await expect(page.getByRole("heading", { name: "Submission Forms", exact: true })).toBeVisible();
        await expect(page.getByText("No forms here")).toBeVisible();
      });
      assertClean();
    });
  });

  test.describe("the form builder", () => {
    test("the builder produces a public form link that returns 200", async ({ page, context, request }) => {
      await loginAsAdmin(page);
      await loginAsAdmin(request);
      const stamp = Date.now();

      await test.step("add a track, a room and a format", async () => {
        for (const [tab, placeholder, name] of [
          ["tracks", "Add track", `E2E Track ${stamp}`],
          ["rooms", "Add room", `E2E Room ${stamp}`],
          ["formats", "Add format", `E2E Format ${stamp}`],
        ] as const) {
          await page.goto(`/events/${EVENTS.main.id}/settings?tab=${tab}`);
          await page.getByPlaceholder(placeholder).fill(name);
          await page.getByRole("button", { name: /^add$/i }).click();
          // The delete affordance carries the saved row's name, so this asserts
          // the server's answer rather than the text still sitting in the input.
          await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible({ timeout: 20_000 });
        }
      });

      let formId = "";

      await test.step("add a dropdown field, a conditional field and a routing rule", async () => {
        await page.goto(`/events/${EVENTS.main.id}/forms`);
        await page.getByRole("button", { name: /create form/i }).click();
        const createDialog = page.getByRole("dialog", { name: "Create a submission form" });
        await createDialog.getByLabel("Internal form name").fill(`E2E builder form ${stamp}`);
        await createDialog.getByRole("button", { name: /^create form$/i }).click();
        await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 });
        formId = /\/forms\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
        expect(formId).not.toEqual("");

        const addQuestion = async (label: string, type: string) => {
          await page.getByRole("button", { name: /add question/i }).first().click();
          const dialog = page.getByRole("dialog", { name: "Add a question" });
          await dialog.getByLabel("Question label").fill(label);
          // Located by the option's own title text rather than by accessible
          // name. Each response-type card renders an icon glyph, a bold title
          // and a description, so its name is "⌄ Dropdown Choose one option" —
          // a name match works, but only while the card's name is its own
          // content. It was not: the grid sat inside `<Field>`'s `<label>`,
          // which labelled the first card with every *other* card's text, so
          // "Dropdown" matched two buttons and "Short text" matched none. The
          // markup is fixed; this locator is chosen so that it depends on the
          // rendered title alone and cannot be pulled off by a neighbour again.
          await dialog.locator(".type-grid button").filter({ has: page.getByText(type, { exact: true }) }).click();
          await dialog.getByRole("button", { name: /^add question$/i }).click();
          await expect(dialog).toHaveCount(0, { timeout: 20_000 });
        };

        // Each "Save question" is one PATCH the builder fires on click, and the
        // next step always depends on its answer: the following save sends the
        // `expectedUpdatedAt` this one returns, and the reload below is the
        // whole point of the conditional assertion — a reload that lands first
        // cancels the save it was supposed to prove. So the click is paired
        // with its response rather than with a guess about how fast Neon is.
        const saveQuestion = async () => {
          const response = page.waitForResponse((candidate) =>
            candidate.url().includes(`/api/internal/forms/${formId}/fields/`)
            && candidate.request().method() === "PATCH");
          await page.getByRole("button", { name: /save question/i }).click();
          const saved = await response;
          expect(saved.status(), `saving a question should succeed: ${await saved.text()}`).toBe(200);
        };

        // A dropdown, with its options typed the way an organizer types them.
        await addQuestion("Session length", "Dropdown");
        await page.getByRole("button", { name: /Session length/ }).first().click();
        await page.getByLabel("Options").fill("Short\nLong");
        await saveQuestion();

        // A conditional one. Switching the rule to "Show when…" seeds a
        // condition against the first earlier question; pointing it at the
        // dropdown is the organizer's next click, and what is asserted is that
        // the rule survives a reload — "Conditional" is rendered from the
        // persisted `visibility` column.
        //
        // Driven through M13b's `<VisibilityRuleEditor>`, which is what the
        // inspector actually mounts now. The old on/off `.switch` and
        // `.condition-editor` it replaced no longer exist, so this step was
        // clicking for markup that had been gone since the rules UI landed. The
        // editor is scoped by class because `<RoutingRulesPanel>` on the canvas
        // renders the same condition row, with the same labels, beside it.
        await addQuestion("Room preference", "Short text");
        await page.getByRole("button", { name: /Room preference/ }).first().click();
        const rule = page.locator(".visibility-rule-editor");
        await rule.getByRole("button", { name: /show when/i }).click();
        await rule.getByLabel("Source question").selectOption({ label: "Session length" });
        await saveQuestion();

        await page.reload();
        await expect(page.getByText("· Conditional")).toBeVisible({ timeout: 20_000 });

        // The routing rule goes through its own route rather than the panel.
        // M13b has since mounted `<RoutingRulesPanel>` on the Abstract step, so
        // the authoring UI exists — but a rule is a *post-submit* effect, and
        // what this spec is here to prove is the link at the end. The endpoint
        // driven here is the one that panel calls, with the same server
        // validation; driving the panel itself belongs to the rules spec.
        const form = await apiData<BuilderForm>(request, `/api/internal/forms/${formId}?eventId=${EVENTS.main.id}`);
        const dropdown = form.sections
          .flatMap((section) => section.fields)
          .find((field) => field.label === "Session length");
        expect(dropdown, "the dropdown question should have been created").toBeTruthy();

        const created = await apiData<{ id: string }>(request, `/api/internal/forms/${formId}/routing-rules?eventId=${EVENTS.main.id}`, {
          method: "POST",
          data: {
            match: "all",
            conditions: [{ sourceFieldId: dropdown?.id, op: "answered" }],
            setTrackId: null,
            addTagIds: [],
            enabled: true,
          },
        });
        expect(created.id).toBeTruthy();
        const rules = await apiData<Array<{ id: string; enabled: boolean }>>(request, `/api/internal/forms/${formId}/routing-rules?eventId=${EVENTS.main.id}`);
        expect(rules.filter((rule) => rule.id === created.id)).toHaveLength(1);
      });

      await test.step("set the form open and copy its link", async () => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.getByRole("button", { name: /open form/i }).click();
        await expect(page.locator(".builder-header .status-badge")).toHaveText("open", { timeout: 20_000 });
        await page.getByRole("button", { name: /copy link/i }).click();
      });

      await test.step("the copied /submit/<slug>/<formId> URL returns 200", async () => {
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toContain(`/submit/${EVENTS.main.slug}/${formId}`);
        const response = await request.get(copied);
        expect(response.status(), `${copied} should serve the public form`).toBe(200);
        // Open, and therefore actually fillable — a 200 that renders the closed
        // page would pass a status check and fail a speaker.
        expect(await response.text()).not.toContain("cfp-closed");
      });
    });
  });
});
