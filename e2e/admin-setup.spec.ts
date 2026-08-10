import { expect, test } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { NO_TARGET, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, TEMPLATE_KEYS_PER_EVENT } from "./helpers/seeded";

/**
 * Goes green when M11 (events + vocab) and M12 (form builder core) land — target
 * CP2, owned by WS-B1.
 *
 * Every gate is a describe-level modifier, never a skip inside a test body: a
 * body-level skip still builds the `page` fixture, so an unlanded step would
 * launch a browser just to skip.
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
    test.skip(!landed("M09"), waitingOn("M09"));

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
    test.skip(!landed("M11"), waitingOn("M11"));

    test("creating an event validates its dates and its slug", async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/events/new");

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
        await page.getByLabel("Starts At").fill(localInput(30, "09:00"));
        await page.getByLabel("Ends At").fill(localInput(30, "08:00"));
        await page.getByRole("button", { name: /create event/i }).click();
        await expect(page.locator(".field-error")).toHaveText(/ends at must be after starts at/i);
        await expect(page).toHaveURL(/\/events\/new/);
      });

      await test.step("a reserved slug is refused", async () => {
        // `api` must not become an event slug — it would shadow the API routes.
        await page.getByLabel("Event slug").fill("api");
        await page.getByLabel("Ends At").fill(localInput(31, "17:00"));
        await page.getByRole("button", { name: /create event/i }).click();
        await expect(page.locator(".field-error")).toHaveText(/reserved word/i);
        await expect(page).toHaveURL(/\/events\/new/);
      });

      await test.step("the new event's settings show every default email template", async () => {
        // 7 domain keys + portal_login + M50's two review keys + M51's
        // speaker_bulk_message. This is what proves M11 called
        // seedDefaultTemplates rather than creating the event bare.
        expect(TEMPLATE_KEYS_PER_EVENT).toBe(11);
        const slug = uniqueSlug("e2e-event");
        await page.getByLabel("Event name").fill("E2E created event");
        await page.getByLabel("Event slug").fill(slug);
        await page.getByRole("button", { name: /create event/i }).click();
        await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}\/settings/, { timeout: 30_000 });

        const eventId = /\/events\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? "";
        expect(eventId, "the create should have redirected to the new event's settings").not.toEqual("");

        // The 8-key rail is where templates are edited (M37's Communications
        // surface); the settings shell owns details and vocabulary only.
        await page.goto(`/events/${eventId}/communications?tab=templates`);
        await expect(page.locator("nav[aria-label='Template keys'] button")).toHaveCount(TEMPLATE_KEYS_PER_EVENT);
        // And the same count from the route the rail reads, so a rail that
        // renders eight buttons over four rows cannot pass this step.
        const templates = await apiData<Array<{ key: string }>>(page.request, `/api/internal/comms/${eventId}/templates`);
        expect(templates).toHaveLength(TEMPLATE_KEYS_PER_EVENT);
        expect(templates.map((template) => template.key)).toContain("portal_login");
      });
    });

    test("the empty event renders empty states, not a crash", async ({ page }) => {
      test.skip(!landed("M09"), waitingOn("M09"));
      const assertClean = expectNoConsoleErrors(page);
      await loginAsAdmin(page);
      await test.step(`${EVENTS.empty.name} renders its designed empty state`, async () => {
        // The standing empty-state test: it must stay genuinely empty, and every
        // surface must render its designed empty state rather than crash.
        await page.goto(`/events/${EVENTS.empty.id}/settings?tab=tracks`);
        await expect(page.getByRole("heading", { name: "Tracks" })).toBeVisible();
        await expect(page.getByText("No tracks yet")).toBeVisible();

        await page.goto(`/events/${EVENTS.empty.id}/forms`);
        await expect(page.getByRole("heading", { name: "Submission Forms" })).toBeVisible();
        await expect(page.getByText("No forms here")).toBeVisible();
      });
      assertClean();
    });
  });

  test.describe("the form builder", () => {
    test.skip(!landed("M11", "M12"), waitingOn("M11", "M12"));

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
          await dialog.getByRole("button", { name: type }).click();
          await dialog.getByRole("button", { name: /^add question$/i }).click();
          await expect(dialog).toHaveCount(0, { timeout: 20_000 });
        };

        // A dropdown, with its options typed the way an organizer types them.
        await addQuestion("Session length", "Dropdown");
        await page.getByRole("button", { name: /Session length/ }).first().click();
        await page.getByLabel("Options").fill("Short\nLong");
        await page.getByRole("button", { name: /save question/i }).click();

        // A conditional one. The toggle seeds a condition against the first
        // earlier question; pointing it at the dropdown is the organizer's next
        // click, and what is asserted is that the rule survives a reload —
        // "Conditional" is rendered from the persisted `visibility` column.
        await addQuestion("Room preference", "Short text");
        await page.getByRole("button", { name: /Room preference/ }).first().click();
        await page.locator(".condition-card .switch").click();
        await page.locator(".condition-editor select").first().selectOption({ label: "Session length" });
        await page.getByRole("button", { name: /save question/i }).click();

        await page.reload();
        await expect(page.getByText("· Conditional")).toBeVisible({ timeout: 20_000 });

        // The routing rule goes through its own route, not the builder: M12's
        // `<RoutingRulesPanel>` exists in the tree but is not mounted by
        // `form-builder.tsx` (the Abstract step renders an explanatory note in
        // its place), so there is no authoring UI to drive. The rule itself is
        // real — same endpoint the panel calls, same server validation — and
        // the missing mount is reported rather than papered over.
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
