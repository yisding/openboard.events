import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { queryRows } from "./helpers/db";
import { EVENTS, uniqueEmail } from "./helpers/seeded";
// The backfilled organization every seeded event belongs to, taken from the
// contract rather than re-typed, exactly as `helpers/auth.ts` takes the portal
// cookie prefix from the feature that owns it.
import { DEFAULT_ORGANIZATION_ID } from "../src/shared/contracts/organization";

/**
 * The organization-level speaker CRM and the Airtable sync surface, against
 * the deployed preview.
 *
 * Together these are ~5,000 lines that no spec mentioned. What is worth a
 * deployed target rather than a unit test here is the part that spans layers:
 *
 *  - a saved segment is *resolved fresh on every read* — the work order's own
 *    AC ("observe membership change after an underlying field edit"), which is
 *    only a real claim if changing the underlying data with one request
 *    changes the answer of a different one;
 *  - the pipeline's optimistic lock refuses a move made against a stage the
 *    organizer is no longer looking at, over a real transaction;
 *  - and the Airtable panel's unconnected state is the screen a first-time
 *    organizer meets, including the disclosure that is deliberately shown
 *    *before* the token field rather than after it.
 */

const ORG = DEFAULT_ORGANIZATION_ID;
const CRM = `/api/internal/organizations/${ORG}/crm`;
const CRM_PAGE = `/organizations/${ORG}/crm`;
const AIRTABLE_API = `/api/internal/events/${EVENTS.main.id}/airtable`;
const AIRTABLE_PAGE = `/events/${EVENTS.main.id}/settings/airtable`;

type ContactId = string;
type DirectoryPage = { rows: Array<{ id: ContactId; email: string; tags: Array<{ id: string; name: string }> }>; total: number };
type CrmTag = { id: string; name: string };
type CrmSegment = { id: string; name: string };
type ResolvedSegment = {
  matchedCount: number;
  organizationContactIds: ContactId[];
  preview: Array<{ organizationContactId: ContactId; name: string; email: string }>;
};
type PipelineEntry = { id: string; organizationContactId: ContactId; stage: "open" | "won" | "lost"; updatedAt: string };
type AirtableStatus = { connection: { status: string } | null; runs: unknown[] };

const resolveSegment = (request: APIRequestContext, segmentId: string): Promise<ResolvedSegment> =>
  apiData<ResolvedSegment>(request, `${CRM}/segments/${segmentId}/resolve`);

/**
 * The CRM has no delete route by design — a directory that forgets people is
 * not a CRM — so this spec's rows are removed directly, and only ever the ones
 * it names itself (`e2e-…@openboard.events`, `E2E …`).
 */
async function removeE2ECrmRows(): Promise<void> {
  const owned = "SELECT id FROM organization_contacts WHERE organization_id = $1 AND email LIKE 'e2e-%@openboard.events'";
  await queryRows(`DELETE FROM organization_contact_pipeline_history WHERE pipeline_id IN (SELECT id FROM organization_contact_pipeline WHERE organization_contact_id IN (${owned}))`, [ORG]);
  await queryRows(`DELETE FROM organization_contact_pipeline WHERE organization_contact_id IN (${owned})`, [ORG]);
  await queryRows(`DELETE FROM organization_contact_tag_links WHERE organization_contact_id IN (${owned})`, [ORG]);
  await queryRows(`DELETE FROM organization_contact_activity WHERE organization_contact_id IN (${owned})`, [ORG]);
  await queryRows(`DELETE FROM organization_contact_notes WHERE organization_contact_id IN (${owned})`, [ORG]);
  await queryRows(`DELETE FROM organization_contact_links WHERE organization_contact_id IN (${owned})`, [ORG]);
  await queryRows("DELETE FROM organization_contacts WHERE organization_id = $1 AND email LIKE 'e2e-%@openboard.events'", [ORG]);
  await queryRows("DELETE FROM organization_contact_segments WHERE organization_id = $1 AND name LIKE 'E2E %'", [ORG]);
  await queryRows("DELETE FROM organization_contact_tags WHERE organization_id = $1 AND name LIKE 'E2E %'", [ORG]);
}

test.describe("crm-directory", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.beforeEach(({}, testInfo) => { testInfo.setTimeout(180_000); });

  test.afterAll(async () => {
    if (!targetConfigured() || !databaseConfigured()) return;
    await removeE2ECrmRows();
  });

  test("a tagged contact joins a saved segment, and leaves it the moment the tag does", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    const stamp = Date.now();
    const email = uniqueEmail("crm");
    const tagName = `E2E keynote ${stamp}`;
    const segmentName = `E2E segment ${stamp}`;

    const contact = await apiData<{ id: ContactId }>(request, `${CRM}/contacts`, {
      method: "POST",
      data: { email, firstName: "Directory", lastName: "Probe", company: "Acme" },
    });
    const tag = await apiData<CrmTag>(request, `${CRM}/tags`, { method: "POST", data: { name: tagName } });

    await test.step("the directory finds the contact by search, with its tag", async () => {
      await apiData(request, `${CRM}/contacts/${contact.id}/tags`, { method: "PUT", data: { tagIds: [tag.id] } });
      const found = await apiData<DirectoryPage>(request, `${CRM}/contacts?search=${encodeURIComponent(email)}`);
      expect(found.total).toBe(1);
      expect(found.rows[0]?.tags.map((row) => row.name)).toEqual([tagName]);
    });

    await test.step("a saved segment is resolved fresh, not materialized", async () => {
      const segment = await apiData<CrmSegment>(request, `${CRM}/segments`, {
        method: "POST",
        data: { name: segmentName, filter: { tagIds: [tag.id] } },
      });
      const segmentId = segment.id;
      const matched = await resolveSegment(request, segmentId);
      expect(matched.matchedCount).toBe(1);
      expect(matched.organizationContactIds).toEqual([contact.id]);

      // Nothing about the *segment* changes here — only the contact's tags.
      // A segment that still reports a match after this is a cached list
      // wearing a segment's name.
      await apiData(request, `${CRM}/contacts/${contact.id}/tags`, { method: "PUT", data: { tagIds: [] } });
      expect((await resolveSegment(request, segmentId)).matchedCount).toBe(0);

      await apiData(request, `${CRM}/contacts/${contact.id}/tags`, { method: "PUT", data: { tagIds: [tag.id] } });
      expect((await resolveSegment(request, segmentId)).matchedCount).toBe(1);
    });

    await test.step("the organizer sees the same answer on the two CRM screens", async () => {
      await page.goto(CRM_PAGE);
      await expect(page.getByRole("heading", { name: "Speaker CRM", level: 1 })).toBeVisible();
      await page.getByRole("textbox", { name: "Search the directory" }).fill(email);
      await page.getByRole("textbox", { name: "Search the directory" }).press("Enter");
      // Filters live in the URL, so a filtered directory is a shareable link.
      await expect.poll(() => new URL(page.url()).searchParams.get("search")).toBe(email);
      const row = page.getByRole("row").filter({ hasText: email });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(tagName);

      await page.goto(`${CRM_PAGE}/segments`);
      const card = page.locator(".crm-segment-card").filter({ hasText: segmentName });
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "View members" }).click();
      await expect(card.getByRole("button", { name: "1 match" })).toBeVisible({ timeout: 20_000 });
      await expect(card.locator(".crm-segment-preview")).toContainText("Directory Probe");
    });

    assertClean();
  });

  test("a prospect moves across the pipeline, and a move made against a stale stage is refused", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    const email = uniqueEmail("crm-pipeline");
    const contact = await apiData<{ id: ContactId }>(request, `${CRM}/contacts`, {
      method: "POST",
      data: { email, firstName: "Pipeline", lastName: "Probe" },
    });
    const opened = await apiData<PipelineEntry>(request, `${CRM}/pipeline`, {
      method: "POST",
      data: { organizationContactId: contact.id, notes: "E2E sourcing" },
    });
    expect(opened.stage).toBe("open");

    await test.step("open → won is recorded, and the same move replays cleanly", async () => {
      const won = await apiData<PipelineEntry>(request, `${CRM}/pipeline/${opened.id}/transition`, {
        method: "POST",
        data: { stage: "won", expectedFrom: "open", expectedUpdatedAt: opened.updatedAt },
      });
      expect(won.stage).toBe("won");
      // A lost response is retried by the board; the replay must be a success,
      // not a conflict, or an organizer is told their completed move failed.
      const replay = await apiData<PipelineEntry>(request, `${CRM}/pipeline/${opened.id}/transition`, {
        method: "POST",
        data: { stage: "won", expectedFrom: "open", expectedUpdatedAt: opened.updatedAt },
      });
      expect(replay.stage).toBe("won");
    });

    await test.step("a move made against the stage the organizer last saw is refused", async () => {
      await expect(apiData(request, `${CRM}/pipeline/${opened.id}/transition`, {
        method: "POST",
        data: { stage: "lost", expectedFrom: "open", expectedUpdatedAt: opened.updatedAt },
      })).rejects.toThrow(/STALE_WRITE/);
      expect((await apiData<PipelineEntry[]>(request, `${CRM}/pipeline`)).find((entry) => entry.id === opened.id)?.stage).toBe("won");
    });

    await test.step("the board draws the prospect in the column it now belongs to", async () => {
      await page.goto(`${CRM_PAGE}/pipeline`);
      const card = page.locator(".crm-board-card").filter({ hasText: email });
      await expect(card).toBeVisible();
      await expect(card.getByRole("combobox", { name: "Move Pipeline Probe" })).toHaveValue("won");
      const wonColumn = page.locator(".crm-board-column")
        .filter({ has: page.locator(".crm-board-column-header", { hasText: "Won" }) });
      await expect(wonColumn.locator(".crm-board-card").filter({ hasText: email })).toHaveCount(1);
    });

    assertClean();
  });

  test.describe("without a database the CRM rows this spec creates cannot be cleaned up", () => {
    test.skip(databaseConfigured(), NO_DATABASE);
    test("is skipped", () => { expect(databaseConfigured()).toBe(false); });
  });
});

test.describe("airtable-sync", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test("an event with no Airtable connection explains itself before asking for a token", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);
    await loginAsAdmin(page);

    // The read that the panel is built on. Not a credential-leak assertion:
    // this environment is seeded without an Airtable connection, so a token
    // regex here would pass against `{"connection":null}` no matter what the
    // handler did. `src/features/airtable/connect-contract.test.ts` seeds a
    // real token into the summary and proves it cannot ride back out.
    const status = await apiData<AirtableStatus>(request, AIRTABLE_API);

    await page.goto(AIRTABLE_PAGE);
    await expect(page.getByRole("heading", { name: "Airtable", level: 1 })).toBeVisible();

    if (status.connection === null) {
      await expect(page.getByRole("heading", { name: "Your program, live in Airtable" })).toBeVisible();
      // The three-step rail is the promise the empty state makes; a connect
      // flow that does not say how long it is, is the one nobody starts.
      for (const step of ["Paste a token", "Pick a base", "Watch it fill"]) {
        await expect(page.locator(".airtable-rail li", { hasText: step })).toBeVisible();
      }

      await page.getByRole("button", { name: "Connect Airtable" }).click();
      const dialog = page.getByRole("dialog", { name: "Paste a personal access token" });
      await expect(dialog).toBeVisible();
      // The disclosure is deliberately above the token field, not below it:
      // "what exactly did you just copy into my base?" is answered before the
      // organizer can answer it the expensive way.
      await expect(dialog.getByText("What we put in your base")).toBeVisible();
      await expect(dialog.getByText("It only goes one way.")).toBeVisible();
      await expect(dialog.getByText(/no attendee data beyond programme people/)).toBeVisible();
    } else {
      // A target whose seeded event is already connected still has to render
      // its run history rather than an empty shell.
      await expect(page.locator(".airtable-empty")).toHaveCount(0);
    }

    assertClean();
  });
});
