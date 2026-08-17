import { expect, test, type Page } from "@playwright/test";
import { apiData, loginAsAdmin } from "./helpers/auth";
import { queryRows, withDatabase } from "./helpers/db";
import { databaseConfigured, NO_DATABASE, NO_TARGET, targetConfigured } from "./helpers/env";

/**
 * First Fair — the demo event and its guided tour, against a real deployment
 * and the real `sb-test` database.
 *
 * What this spec is for, and what it deliberately leaves to others:
 *
 *   - `self-service-onboarding.spec.ts` owns the signup leg and the *other*
 *     door out of the fork ("Set up my real event"). It is extended, not
 *     forked, because there is exactly one dedicated signup mailbox and two
 *     specs competing for it would spend the real one-hour abuse budget on
 *     each other.
 *   - This spec owns everything after the fork: provisioning, the redirect
 *     matrix that must never trap anybody, a real click completing a real
 *     objective, pause/reload/resume across a hard navigation, the Chapter 7
 *     set piece, the curtain call and its milestone, and delete →
 *     re-provision.
 *
 * The organization is created directly in `sb-test` rather than by signing up
 * again. That is the harness talking to its own fixture database, the same
 * licence `e2e/helpers/db.ts` already exercises — and it is the only way to
 * get a *second* brand-new organization in a suite with one mailbox. Every
 * assertion after that point goes through the deployed product.
 *
 * Drag-and-drop placement is explicitly **not** tested (quality-strategy §3
 * bans drag simulation); Chapter 7's placement is dialog-driven, which is also
 * the accessible path.
 */

const ORGANIZATION_PREFIX = "E2E Demo Tour ";
const PROVISIONING_BUDGET_MS = 120_000;

type OrganizationRow = { id: string; name: string; slug: string };

/**
 * Remove every organization this spec has ever created, and only those.
 *
 * Events first, then the organization: `organizations` deliberately RESTRICTs
 * while an event exists, and that ordering is the one
 * `self-service-onboarding.spec.ts` documents. The name prefix is the safety
 * catch — a workspace without it is somebody's real one and is left alone.
 */
async function removePriorDemoOrganizations(currentUserEmail: string): Promise<void> {
  await withDatabase(async (client) => {
    const owned = await client.query<{ id: string; name: string }>(
      `SELECT organization.id, organization.name
         FROM organizations organization
         JOIN organization_members member ON member.organization_id = organization.id
         JOIN users person ON person.id = member.user_id
        WHERE organization.name LIKE $1 AND lower(person.email) = lower($2) AND member.role = 'owner'`,
      [`${ORGANIZATION_PREFIX}%`, currentUserEmail],
    );
    for (const organization of owned.rows) {
      if (!organization.name.startsWith(ORGANIZATION_PREFIX)) continue;
      await client.query("DELETE FROM events WHERE organization_id = $1", [organization.id]);
      await client.query("DELETE FROM organizations WHERE id = $1", [organization.id]);
    }
  });
}

/** A brand-new workspace owned by the signed-in organizer, with no events in it. */
async function createEmptyOrganization(email: string, stamp: string): Promise<OrganizationRow> {
  return withDatabase(async (client) => {
    const name = `${ORGANIZATION_PREFIX}${stamp}`;
    const slug = `e2e-demo-tour-${stamp}`;
    const created = await client.query<OrganizationRow>(
      "INSERT INTO organizations(name, slug) VALUES($1, $2) RETURNING id, name, slug",
      [name, slug],
    );
    const organization = created.rows[0];
    if (!organization) throw new Error("could not create the E2E organization");
    await client.query(
      `INSERT INTO organization_members(organization_id, user_id, role)
       SELECT $1, id, 'owner' FROM users WHERE lower(email) = lower($2)`,
      [organization.id, email],
    );
    return organization;
  });
}

/** The coach card, wherever it is portalled to — body, or into an open dialog. */
function coach(page: Page) {
  return page.locator(".tour-coach").first();
}

async function milestones(organizationId: string): Promise<string[]> {
  const rows = await queryRows<{ milestone: string }>(
    "SELECT milestone FROM organization_onboarding_milestones WHERE organization_id = $1 ORDER BY milestone",
    [organizationId],
  );
  return rows.map((row) => row.milestone);
}

test.describe("the demo event and its guided tour", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.skip(!databaseConfigured(), NO_DATABASE);

  const organizerEmail = "organizer@openboard.dev";

  test("a new workspace builds a demo, is guided through it, and can throw it away", async ({ page }) => {
    // One continuous journey on purpose: provisioning is ten sequential POSTs
    // and the tour's own assertions only mean anything against the world those
    // POSTs produced. The per-step limits below are the failure signals.
    test.setTimeout(600_000);
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);

    const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    await removePriorDemoOrganizations(organizerEmail);
    await loginAsAdmin(page, organizerEmail);
    const organization = await createEmptyOrganization(organizerEmail, stamp);
    const organizationHref = `/organizations/${organization.id}`;

    let eventId = "";
    let eventSlug = "";

    await test.step("an organization with nothing in it is offered the fork, not a form", async () => {
      // Trap A/B, the "no events, no checkpoint" row of the §1.4 matrix: the
      // organization home redirects into the setup route, which renders the
      // choice rather than the wizard.
      await page.goto(organizationHref);
      await expect(page).toHaveURL(new RegExp(`${organizationHref}/onboarding$`));
      await expect(page.getByRole("heading", { name: "Explore a finished conference" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Set up my real event" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Skip both/u })).toBeVisible();
      // The other door never meets the fork again.
      await expect(page.getByRole("link", { name: /Start setting it up/u }))
        .toHaveAttribute("href", `${organizationHref}/onboarding?mode=create`);

      await page.goto(`${organizationHref}/onboarding?mode=create`);
      await expect(page.getByRole("heading", { name: "Step 1: Event details" })).toBeVisible();

      // ...and the escape hatch reaches the organization home without looping.
      const skipped = await page.goto(`${organizationHref}?skip=1`);
      expect(skipped?.status(), "?skip=1 must buy exactly one request without the eventless redirect").toBe(200);
      expect(new URL(page.url()).pathname).toBe(organizationHref);
    });

    await test.step("the demo is built one narrated phase at a time", async () => {
      await page.goto(`${organizationHref}/onboarding?mode=demo`);
      await page.getByRole("button", { name: /Build it for me/u }).click();

      const progress = page.getByLabel("Demo event build progress");
      await expect(progress).toBeVisible();
      await expect(page.getByRole("heading", { name: /Building AI Engineer World.s Fair/u })).toBeVisible();

      // Ten POSTs, then a push to the demo's own dashboard.
      await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}\/dashboard/u, { timeout: PROVISIONING_BUDGET_MS });
      eventId = new URL(page.url()).pathname.split("/")[2] ?? "";
      expect(eventId).toMatch(/^[0-9a-f-]{36}$/u);

      const [event] = await queryRows<{ slug: string; is_demo: boolean; organization_id: string }>(
        "SELECT slug, is_demo, organization_id FROM events WHERE id = $1",
        [eventId],
      );
      eventSlug = event?.slug ?? "";
      expect(event?.is_demo, "the flag is written inside the INSERT, never afterwards").toBe(true);
      expect(event?.organization_id).toBe(organization.id);
      expect(eventSlug).toContain("-demo-");

      // The world the cold open promises, verified in rows rather than in copy.
      const [counts] = await queryRows<{ contacts: number; submissions: number; sessions: number; templates: number }>(
        `SELECT (SELECT count(*)::int FROM contacts WHERE event_id = $1) AS contacts,
                (SELECT count(*)::int FROM submissions WHERE event_id = $1) AS submissions,
                (SELECT count(*)::int FROM sessions WHERE event_id = $1) AS sessions,
                (SELECT count(*)::int FROM email_templates WHERE event_id = $1) AS templates`,
        [eventId],
      );
      expect(counts?.contacts).toBe(18);
      expect(counts?.submissions).toBe(24);
      expect(counts?.sessions).toBeGreaterThanOrEqual(20);
      expect(counts?.templates).toBe(14);

      // Trap A, the single most important assertion in the suite.
      const progressRows = await queryRows<{ n: number }>(
        "SELECT count(*)::int AS n FROM event_onboarding_progress WHERE event_id = $1",
        [eventId],
      );
      expect(progressRows[0]?.n, "a demo must never write a setup checkpoint").toBe(0);
      expect(await milestones(organization.id)).toContain("demo_provisioned");
      expect(await milestones(organization.id), "a tutorial is not a conversion").not.toContain("event_created");

      // Rail 3: nothing provisioning wrote is drainable by the outbox cron.
      const queued = await queryRows<{ n: number }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND status = 'queued'",
        [eventId],
      );
      expect(queued[0]?.n).toBe(0);
    });

    await test.step("the demo is labelled everywhere an organizer can see it", async () => {
      await expect(page.locator(".breadcrumbs").getByText("Demo", { exact: true })).toBeVisible();

      const publicPage = await page.request.get(`/e/${eventSlug}/agenda`);
      expect(publicPage.status()).toBe(200);
      const html = await publicPage.text();
      expect(html, "a fabricated conference never enters a search index").toContain("noindex");
      expect(html.replaceAll("<!-- -->", "")).toContain("Sample event");
    });

    await test.step("Chapter 1 completes on a real click, not on a scripted one", async () => {
      // The cold open owns the screen; taking the tour is one button.
      const opening = page.getByRole("dialog").filter({ hasText: "AI Engineer World’s Fair is 65 days out." });
      await expect(opening).toBeVisible();
      await expect(opening).toContainText("nothing in here can email a living person");
      await opening.getByRole("button", { name: "Let’s go" }).click();

      // Two observes, then the chapter's act. Each observe satisfies on dwell.
      for (const title of ["Everything that needs you, ranked.", "Press ⌘K."]) {
        await expect(coach(page)).toContainText(title);
        await coach(page).getByRole("button", { name: "Got it" }).click();
      }

      await expect(coach(page)).toContainText("Open Speaker Tracking.");
      // No Continue on an `act`: the objective is the only way forward, and it
      // is satisfied by pressing the product's own control.
      await expect(coach(page).getByRole("button", { name: "Continue" })).toHaveCount(0);
      await page.locator(".dashboard-tabs").getByRole("link", { name: /Speaker/u }).click();
      await expect(page).toHaveURL(/tab=speakers/u);
      await expect(coach(page)).toContainText("You can drive.");
    });

    await test.step("pausing costs one keystroke, and a reload resumes on the same step", async () => {
      await expect(coach(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(coach(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Resume the tour" })).toBeVisible();

      const [cursor] = await queryRows<{ tour_state: string; step_id: string }>(
        "SELECT tour_state, step_id FROM event_demo_tour WHERE event_id = $1",
        [eventId],
      );
      expect(cursor?.tour_state, "Esc pauses without a confirmation dialog").toBe("paused");
      const pausedAt = cursor?.step_id ?? "";
      expect(pausedAt).not.toBe("");

      // A hard reload, because the cursor is a row and not a React state.
      await page.reload();
      await page.getByRole("button", { name: "Resume the tour" }).click();
      await expect(coach(page)).toBeVisible();
      const [resumed] = await queryRows<{ tour_state: string; step_id: string }>(
        "SELECT tour_state, step_id FROM event_demo_tour WHERE event_id = $1",
        [eventId],
      );
      expect(resumed?.tour_state).toBe("active");
      expect(resumed?.step_id, "resume returns to the step the player left").toBe(pausedAt);
    });

    await test.step("Chapter 7 springs its trap and the organizer disarms it", async () => {
      // Skip forward chapter by chapter rather than replaying six chapters of
      // product: what is under test here is the conflict engine agreeing with
      // itself, not the chapters in between.
      for (let chapter = 0; chapter < 8; chapter += 1) {
        const [cursor] = await queryRows<{ chapter: string }>(
          "SELECT chapter FROM event_demo_tour WHERE event_id = $1",
          [eventId],
        );
        if (cursor?.chapter === "the-grid") break;
        await coach(page).getByText("Tour options", { exact: true }).click();
        await coach(page).getByRole("button", { name: "Skip this chapter" }).click();
        await expect(coach(page)).toBeVisible();
      }
      await expect(page).toHaveURL(/\/agenda/u, { timeout: 60_000 });

      const tourState = await apiData<{ world: { conflictCount: number } }>(
        page.request,
        `/api/internal/events/${eventId}/tour`,
      );
      const conflictsBefore = tourState.world.conflictCount;
      expect(conflictsBefore, "the demo plants collisions the organizer has not noticed yet")
        .toBeGreaterThan(0);

      // Resolve one through the real writer the Conflicts view drives, then
      // let the poll notice. The objective is world state, so it does not
      // matter which of the two sessions moved or from which screen.
      const [clash] = await queryRows<{
        id: string; row_version: number; title: string; description_html: string;
        starts_at: string; ends_at: string; format_id: string | null; track_id: string | null; free_room_id: string;
      }>(
        `SELECT a.id, a.row_version, a.title, coalesce(a.description_html, '') AS description_html,
                a.starts_at::text, a.ends_at::text, a.format_id, a.track_id,
                (SELECT r.id FROM rooms r
                  WHERE r.event_id = a.event_id
                    AND NOT EXISTS (SELECT 1 FROM sessions o
                                     WHERE o.event_id = a.event_id AND o.room_id = r.id AND o.id <> a.id
                                       AND o.starts_at < a.ends_at AND a.starts_at < o.ends_at)
                  ORDER BY r.sort_order, r.id LIMIT 1) AS free_room_id
           FROM sessions a JOIN sessions b
             ON b.event_id = a.event_id AND b.id <> a.id AND b.room_id = a.room_id
            AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at
          WHERE a.event_id = $1 AND a.room_id IS NOT NULL
          ORDER BY a.starts_at, a.id LIMIT 1`,
        [eventId],
      );
      if (!clash) throw new Error("the demo provisioned no room collision for Chapter 7 to resolve");
      const speakers = await queryRows<{ contact_id: string }>(
        "SELECT contact_id FROM session_speakers WHERE session_id = $1",
        [clash.id],
      );
      await apiData(page.request, `/api/internal/agenda/sessions/${clash.id}?eventId=${eventId}`, {
        method: "PATCH",
        data: {
          id: clash.id,
          expectedVersion: clash.row_version,
          title: clash.title,
          descriptionHtml: clash.description_html,
          formatId: clash.format_id,
          trackId: clash.track_id,
          roomId: clash.free_room_id,
          startsAt: new Date(clash.starts_at).toISOString(),
          endsAt: new Date(clash.ends_at).toISOString(),
          speakerContactIds: speakers.map((row) => row.contact_id),
          status: "draft",
        },
      });

      await expect.poll(async () => {
        const state = await apiData<{ world: { conflictCount: number } }>(
          page.request,
          `/api/internal/events/${eventId}/tour`,
        );
        return state.world.conflictCount;
      }, {
        message: "the world query must see the resolution the agenda writer committed",
        timeout: 30_000,
      }).toBeLessThan(conflictsBefore);
    });

    await test.step("the curtain call records the milestone", async () => {
      await coach(page).getByText("Tour options", { exact: true }).click();
      await coach(page).getByRole("button", { name: "Finish the tour for good" }).click();

      await expect.poll(async () => (await queryRows<{ tour_state: string }>(
        "SELECT tour_state FROM event_demo_tour WHERE event_id = $1",
        [eventId],
      ))[0]?.tour_state, { message: "finishing must move the durable cursor", timeout: 30_000 })
        .toBe("complete");
      expect(await milestones(organization.id)).toContain("tour_completed");
    });

    await test.step("the demo can be thrown away and rebuilt at the same id", async () => {
      const rebuilt = await apiData<{ eventId: string; done: boolean }>(
        page.request,
        `/api/internal/organizations/${organization.id}/demo`,
        { method: "POST", data: { mode: "reset" } },
      );
      expect(rebuilt.eventId, "reset rebuilds at the same deterministic id").toBe(eventId);
      for (let request = 0; request < 12; request += 1) {
        const state = await apiData<{ done: boolean }>(
          page.request,
          `/api/internal/organizations/${organization.id}/demo`,
          { method: "POST", data: { mode: "provision" } },
        );
        if (state.done) break;
      }

      const [after] = await queryRows<{ contacts: number; tour: number }>(
        `SELECT (SELECT count(*)::int FROM contacts WHERE event_id = $1) AS contacts,
                (SELECT count(*)::int FROM event_demo_tour WHERE event_id = $1) AS tour`,
        [eventId],
      );
      expect(after?.contacts, "a rebuilt world is a complete world, with no duplicates").toBe(18);
      expect(after?.tour, "the cursor cascades away with the event and is written fresh").toBe(1);

      const discarded = await apiData<{ deleted: boolean }>(
        page.request,
        `/api/internal/organizations/${organization.id}/demo`,
        { method: "DELETE", data: { confirm: "DELETE" } },
      );
      expect(discarded.deleted).toBe(true);
      const remaining = await queryRows<{ n: number }>(
        "SELECT count(*)::int AS n FROM events WHERE organization_id = $1",
        [organization.id],
      );
      expect(remaining[0]?.n).toBe(0);
    });

    await test.step("an organization that already runs events is never interrupted", async () => {
      // The seeded organizer's own workspace has real events in it, and the
      // eventless nudge must be dead there for good.
      const organizations = await apiData<Array<{ id: string; role: string }>>(page.request, "/api/internal/organizations");
      const withEvents = await Promise.all(organizations.map(async (candidate) => {
        const events = await queryRows<{ n: number }>(
          "SELECT count(*)::int AS n FROM events WHERE organization_id = $1 AND NOT is_demo",
          [candidate.id],
        );
        return { id: candidate.id, events: events[0]?.n ?? 0 };
      }));
      const established = withEvents.find((candidate) => candidate.events > 0);
      if (!established) throw new Error("the seeded organizer owns no organization with a real event");

      const response = await page.goto(`/organizations/${established.id}`);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname, "an established organization is never redirected into setup")
        .toBe(`/organizations/${established.id}`);
      await page.goto(`/organizations/${established.id}/onboarding`);
      await expect(
        page.getByRole("heading", { name: "Explore a finished conference" }),
        "an organization with events reaches the wizard, not the fork",
      ).toHaveCount(0);
    });

    await removePriorDemoOrganizations(organizerEmail);
  });
});
