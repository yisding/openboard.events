import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { createEventIn } from "@/features/events";
import { createOrganizationIn } from "@/features/organizations";
import { eventIdSchema, organizationIdSchema, userIdSchema, type EventId, type OrganizationId, type UserId } from "@/shared/contracts";
import { applyProductMigrations } from "../../../../../scripts/lib/product-migrations";
import { DEMO_RUNNABLE_PHASES } from "../../demo-schemas";
import { demoEventId } from "./ids";
import { demoFormId } from "./phases/context";
import { advanceDemoProvisioningIn } from "./provisioning";
import { copyDemoScaffoldForActorIn, copyDemoScaffoldIn, DEMO_SCAFFOLD_TABLES } from "./template-copy";

/**
 * First Fair (design §5.4) — "Start from my demo's setup". The closed set of
 * tables it may copy is a contract, not an implementation detail: this file
 * pins `DEMO_SCAFFOLD_TABLES` to the exact list the design names, and proves
 * a full run touches *only* those tables — inserting zero rows into
 * `contacts` / `submissions` / `sessions` / `portal_tasks` /
 * `communication_logs` on the new event. A copy that quietly widened is a
 * contact importer wearing a checkbox's clothes.
 */
describe("copying a demo's scaffold onto a real event", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let ownerUserId: UserId;

  const inTransaction = <T,>(work: (tx: TxDb) => Promise<T>): Promise<T> => work(database as TxDb);

  // `copyDemoScaffoldIn` only ever reads vocabulary and the CFP form, which
  // phases "event" and "forms" produce — so this drives the cursor exactly
  // that far rather than the whole ten-phase run. (Phase "people" sits
  // between them and is free either way; later phases are irrelevant here
  // and skipping them keeps this file decoupled from phases 4-10's own
  // fixtures and tests.)
  const PHASES_THROUGH_FORMS = DEMO_RUNNABLE_PHASES.indexOf("forms") + 1;

  async function organizationWithProvisionedDemo(slug: string): Promise<{ organizationId: OrganizationId; eventId: EventId }> {
    const organization = await createOrganizationIn(database, ownerUserId, { name: slug, slug });
    const organizationId = organizationIdSchema.parse(organization.id);
    for (let step = 0; step < PHASES_THROUGH_FORMS; step += 1) {
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
    }
    return { organizationId, eventId: eventIdSchema.parse(demoEventId(organizationId)) };
  }

  async function createRealEvent(organizationId: OrganizationId, slug: string): Promise<EventId> {
    const created = await createEventIn(database, ownerUserId, {
      name: `${slug} real event`,
      slug,
      eventType: "conference",
      timezone: "America/Los_Angeles",
      startsAt: "2099-09-15T16:00:00.000Z",
      endsAt: "2099-09-17T01:00:00.000Z",
    }, organizationId);
    return created.id;
  }

  async function rowCount(table: string, eventId: EventId): Promise<number> {
    const result = await pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE event_id = $1`, [eventId]);
    return result.rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["template-copy-owner@test.dev", "Owner"],
    );
    ownerUserId = userIdSchema.parse(inserted.rows[0]?.id);
  }, 180_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("pins the closed table set the design names", () => {
    expect(DEMO_SCAFFOLD_TABLES).toEqual(["tracks", "rooms", "session_formats", "tags", "forms"]);
  });

  it("copies vocabulary and the call-for-speakers form, and nothing else", async () => {
    const { eventId: demoId } = await organizationWithProvisionedDemo("template-copy-happy-path");
    const organizationId = organizationIdSchema.parse(
      (await database.select({ organizationId: schema.events.organizationId }).from(schema.events).where(eq(schema.events.id, demoId)).limit(1))[0]?.organizationId,
    );
    const realEventId = await createRealEvent(organizationId, "template-copy-real-event");

    await copyDemoScaffoldIn(database, demoId, realEventId);

    const [demoTracks, realTracks] = await Promise.all([
      database.select().from(schema.tracks).where(eq(schema.tracks.eventId, demoId)),
      database.select().from(schema.tracks).where(eq(schema.tracks.eventId, realEventId)),
    ]);
    expect(demoTracks.length).toBeGreaterThan(0);
    expect(new Set(realTracks.map((row) => row.name))).toEqual(new Set(demoTracks.map((row) => row.name)));

    const realForm = await database.select().from(schema.forms).where(and(eq(schema.forms.eventId, realEventId), eq(schema.forms.context, "cfp"))).limit(1);
    expect(realForm.length).toBe(1);
    expect(realForm[0]?.currentVersion).toBeGreaterThanOrEqual(2);

    // Scoped to the CFP form specifically: the demo also has a second form
    // ("Expo Stage Lightning Talks"), which `copyDemoScaffoldIn` never
    // touches — the design's "one form's structure", not every form.
    const demoCfpFormId = demoFormId(demoId, "cfp");
    const [demoFields, realFields] = await Promise.all([
      database.select().from(schema.formFields).where(eq(schema.formFields.formId, demoCfpFormId)),
      database.select().from(schema.formFields).where(eq(schema.formFields.eventId, realEventId)),
    ]);
    expect(demoFields.length).toBeGreaterThan(0);
    expect(realFields.length).toBe(demoFields.length);

    // The conditional field — Chapter 2's whole payoff — survives the copy,
    // re-pointed at the new event's own Format field and Workshop option.
    const conditionalField = realFields.find((field) => field.key === "workshop_duration");
    expect(conditionalField?.visibility).toMatchObject({
      match: "all",
      conditions: [{ op: "eq" }],
    });
    const formatField = realFields.find((field) => field.key === "format");
    const workshopOption = (formatField?.options as Array<{ id: string; label: string }> | null)?.find((option) => option.label === "Workshop");
    const conditions = (conditionalField?.visibility as { conditions: Array<{ sourceFieldId: string; value: string }> } | null)?.conditions ?? [];
    expect(conditions[0]?.sourceFieldId).toBe(formatField?.id);
    expect(conditions[0]?.value).toBe(workshopOption?.id);

    // The copied form answers to the organizer's event, not to the demo
    // conference. Carrying `Speak at AI Engineer World’s Fair` onto a
    // marketing event is how "a bunch of stuff from the AI Engineer events"
    // gets reported: a name they never chose, for a conference they have never
    // heard of, on their own call for speakers.
    const copiedCfp = (await database.select().from(schema.forms).where(eq(schema.forms.eventId, realEventId)))
      .find((form) => form.context === "cfp" && form.internalName.startsWith("Speak at "));
    expect(copiedCfp?.internalName).toBe("Speak at template-copy-real-event real event");

    // The closed set, proven negatively: zero rows landed anywhere else.
    await Promise.all([
      expect(rowCount("contacts", realEventId)).resolves.toBe(0),
      expect(rowCount("submissions", realEventId)).resolves.toBe(0),
      expect(rowCount("sessions", realEventId)).resolves.toBe(0),
      expect(rowCount("portal_tasks", realEventId)).resolves.toBe(0),
      expect(rowCount("communication_logs", realEventId)).resolves.toBe(0),
    ]);
  }, 180_000);

  /**
   * An organizer at free play can add a rule the dataset never contains: "show
   * Approach when Topics is one of Evals or Safety". Its value is an *array* of
   * option ids, and the copy re-ids every option underneath it — so a remap
   * that only handled a single string value carried the demo's ids onto the
   * organizer's brand-new form, where the question they were promised never
   * appeared and nothing said why.
   */
  it("re-points a multi-option rule an organizer added during free play", async () => {
    const { eventId: demoId } = await organizationWithProvisionedDemo("template-copy-multi-option-rule");
    const organizationId = organizationIdSchema.parse(
      (await database.select({ organizationId: schema.events.organizationId }).from(schema.events).where(eq(schema.events.id, demoId)).limit(1))[0]?.organizationId,
    );
    const realEventId = await createRealEvent(organizationId, "template-copy-multi-option-real");

    const demoCfpFormId = demoFormId(demoId, "cfp");
    const demoFields = await database.select().from(schema.formFields).where(eq(schema.formFields.formId, demoCfpFormId));
    const topics = demoFields.find((field) => field.key === "topics");
    const approach = demoFields.find((field) => field.key === "approach");
    const topicOptions = (topics?.options as Array<{ id: string; label: string }> | null) ?? [];
    expect(topicOptions.length).toBeGreaterThan(1);
    const chosen = topicOptions.slice(0, 2);

    await database.update(schema.formFields)
      .set({ visibility: { match: "all", conditions: [{ sourceFieldId: topics?.id, op: "in", value: chosen.map((option) => option.id) }] } })
      .where(eq(schema.formFields.id, approach?.id ?? ""));

    await copyDemoScaffoldIn(database, demoId, realEventId);

    const realFields = await database.select().from(schema.formFields).where(eq(schema.formFields.eventId, realEventId));
    const copiedTopics = realFields.find((field) => field.key === "topics");
    const copiedTopicOptions = (copiedTopics?.options as Array<{ id: string; label: string }> | null) ?? [];
    const expected = chosen.map((option) => copiedTopicOptions.find((candidate) => candidate.label === option.label)?.id);
    expect(expected.every((id) => typeof id === "string")).toBe(true);

    const copiedApproach = realFields.find((field) => field.key === "approach");
    expect(copiedApproach?.visibility).toEqual({
      match: "all",
      conditions: [{ sourceFieldId: copiedTopics?.id, op: "in", value: expected }],
    });
  }, 180_000);

  /**
   * The other half of the same trap. `remapOptions` drops an option whose tag
   * did not survive the copy, but the *source* form still lists that option —
   * so a rule naming it looked remappable and produced a stable id for an
   * option the copy never wrote. Since a dangling condition value now fails the
   * publish, that turned "I deleted a tag during free play" into a scaffold
   * copy that raises instead of one that quietly loses a question.
   */
  it("drops a rule whose option lost the tag it was bound to", async () => {
    const { eventId: demoId } = await organizationWithProvisionedDemo("template-copy-dropped-option");
    const organizationId = organizationIdSchema.parse(
      (await database.select({ organizationId: schema.events.organizationId }).from(schema.events).where(eq(schema.events.id, demoId)).limit(1))[0]?.organizationId,
    );
    const realEventId = await createRealEvent(organizationId, "template-copy-dropped-option-real");

    const demoCfpFormId = demoFormId(demoId, "cfp");
    const demoFields = await database.select().from(schema.formFields).where(eq(schema.formFields.formId, demoCfpFormId));
    const topics = demoFields.find((field) => field.key === "topics");
    const approach = demoFields.find((field) => field.key === "approach");
    const doomed = ((topics?.options as Array<{ id: string; tagId?: string }> | null) ?? []).find((option) => option.tagId);
    expect(doomed?.tagId).toBeDefined();

    await database.update(schema.formFields)
      .set({ visibility: { match: "all", conditions: [{ sourceFieldId: topics?.id, op: "eq", value: doomed?.id }] } })
      .where(eq(schema.formFields.id, approach?.id ?? ""));
    await database.delete(schema.tags).where(eq(schema.tags.id, doomed?.tagId ?? ""));

    await copyDemoScaffoldIn(database, demoId, realEventId);

    const realFields = await database.select().from(schema.formFields).where(eq(schema.formFields.eventId, realEventId));
    expect(realFields.length).toBeGreaterThan(0);
    expect(realFields.find((field) => field.key === "approach")?.visibility).toBeNull();
  }, 180_000);

  it("is a no-op when the organization's demo was never provisioned", async () => {
    const organization = await createOrganizationIn(database, ownerUserId, { name: "template-copy-no-demo", slug: "template-copy-no-demo" });
    const organizationId = organizationIdSchema.parse(organization.id);
    const realEventId = await createRealEvent(organizationId, "template-copy-no-demo-target");

    await expect(copyDemoScaffoldIn(database, demoEventId(organizationId), realEventId)).resolves.toBeUndefined();

    const realForms = await database.select().from(schema.forms).where(eq(schema.forms.eventId, realEventId));
    // Only the platform's own onboarding defaults exist — nothing copied.
    expect(realForms.every((form) => form.context !== "cfp" || form.currentVersion < 2 || form.internalName !== "Speak at AI Engineer World’s Fair")).toBe(true);
  }, 60_000);

  it("converges on a second copy instead of duplicating", async () => {
    const { eventId: demoId } = await organizationWithProvisionedDemo("template-copy-idempotent");
    const organizationId = organizationIdSchema.parse(
      (await database.select({ organizationId: schema.events.organizationId }).from(schema.events).where(eq(schema.events.id, demoId)).limit(1))[0]?.organizationId,
    );
    const realEventId = await createRealEvent(organizationId, "template-copy-idempotent-real");

    await copyDemoScaffoldIn(database, demoId, realEventId);
    const firstPass = await database.select().from(schema.formFields).where(eq(schema.formFields.eventId, realEventId));
    await copyDemoScaffoldIn(database, demoId, realEventId);
    const secondPass = await database.select().from(schema.formFields).where(eq(schema.formFields.eventId, realEventId));

    expect(secondPass.length).toBe(firstPass.length);
  }, 180_000);

  it("records the funnel milestone and refuses a target that is itself a demo", async () => {
    const { organizationId, eventId: demoId } = await organizationWithProvisionedDemo("template-copy-actor-path");
    const realEventId = await createRealEvent(organizationId, "template-copy-actor-real");

    await expect(copyDemoScaffoldForActorIn(database, inTransaction, ownerUserId, organizationId, realEventId))
      .resolves.toEqual({ copied: true });

    const milestones = await database.select({ milestone: schema.organizationOnboardingMilestones.milestone })
      .from(schema.organizationOnboardingMilestones)
      .where(eq(schema.organizationOnboardingMilestones.organizationId, organizationId));
    expect(milestones.map((row) => row.milestone)).toContain("real_event_after_demo");

    await expect(copyDemoScaffoldForActorIn(database, inTransaction, ownerUserId, organizationId, demoId))
      .rejects.toMatchObject({ code: "VALIDATION" });
  }, 180_000);

  /**
   * The route is `organizationAuth()`, and the write target comes from the
   * request body — so the only thing standing between an organization
   * organizer and an event they cannot open is this check. `copyVocabularyIn`
   * upserts on `(event_id, name)`, so a missing check is a destructive write
   * primitive, not merely a read.
   */
  it("refuses a target event the actor is not an organizer on", async () => {
    const { organizationId } = await organizationWithProvisionedDemo("template-copy-tenancy");
    const realEventId = await createRealEvent(organizationId, "template-copy-tenancy-real");

    const stranger = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["template-copy-stranger@test.dev", "Org organizer, not an event member"],
    );
    const strangerUserId = userIdSchema.parse(stranger.rows[0]?.id);
    await pglite.query(
      "INSERT INTO organization_members(user_id,organization_id,role) VALUES($1,$2,'organizer')",
      [strangerUserId, organizationId],
    );

    await expect(copyDemoScaffoldForActorIn(database, inTransaction, strangerUserId, organizationId, realEventId))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    // Nothing landed: the refusal happens before the transaction opens.
    const audits = await database.select({ action: schema.organizationAuditLog.action })
      .from(schema.organizationAuditLog)
      .where(eq(schema.organizationAuditLog.organizationId, organizationId));
    expect(audits.map((row) => row.action)).not.toContain("demo.scaffold_copied");
  }, 180_000);
});
