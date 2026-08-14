import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { communicationLogs } from "@/db/schema";
import { listOutstandingReviewersIn, sendReviewRemindersIn } from "@/features/comms";
import { buildContext, type OutboxRow } from "@/features/comms/server/context";
import { renderTemplateContent } from "@/features/comms/index.render";
import { DEFAULT_TEMPLATES } from "@/features/comms/server/templates";
import { parseEnv } from "@/shared/lib/env";
import {
  assignReviewersIn,
  assignSubmissionsIn,
  getPlanIn,
  getRatingsIn,
  getReviewerSubmissionDetailIn,
  listAssignableSubmissionsIn,
  listReviewerPlansIn,
  listReviewHistoryIn,
  listReviewQueueIn,
  planInputSchema,
  recuseAssignmentIn,
  savePlanIn,
  submitReviewIn,
} from "@/features/submissions";
import {
  eventIdSchema,
  fieldIdSchema,
  formIdSchema,
  idem,
  sectionIdSchema,
  submissionIdSchema,
  trackIdSchema,
  userIdSchema,
  type FormSnapshot,
  type PlanId,
} from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * M50 — review operations depth.
 *
 * The suite is written against the acceptance criteria rather than the
 * implementation: windows, explicit assignment, blindness, typed criteria,
 * progress, reminders and recusal are each checked through the exported server
 * functions, because those are what the routes call and what a reviewer's
 * afternoon actually depends on.
 */

/**
 * Every journaled migration, in order. This suite reaches across features —
 * evaluation, forms, contacts and the outbox — so pinning a hand-picked subset
 * would break the moment a neighbouring module adds a column.
 */
const migrationsDir = new URL("../../drizzle/", import.meta.url);
const MIGRATIONS = (JSON.parse(readFileSync(new URL("meta/_journal.json", migrationsDir), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
}).entries
  .sort((left, right) => left.idx - right.idx)
  .map((entry) => readFileSync(new URL(`${entry.tag}.sql`, migrationsDir), "utf8"));

const eventId = eventIdSchema.parse("c5000000-0000-4000-8000-000000000001");
const platforms = trackIdSchema.parse("c5000000-0000-4000-8000-000000000010");
const agents = trackIdSchema.parse("c5000000-0000-4000-8000-000000000011");

const ada = userIdSchema.parse("c5000000-0000-4000-8000-000000000020");
const grace = userIdSchema.parse("c5000000-0000-4000-8000-000000000021");
const organizer = userIdSchema.parse("c5000000-0000-4000-8000-000000000022");
const ambiguousReviewer = userIdSchema.parse("c5000000-0000-4000-8000-000000000023");

const author = "c5000000-0000-4000-8000-000000000040";
const coAuthor = "c5000000-0000-4000-8000-000000000041";
const adaContact = "c5000000-0000-4000-8000-000000000042";
const ambiguousReviewerContact = "c5000000-0000-4000-8000-000000000043";

const one = submissionIdSchema.parse("c5000000-0000-4000-8000-000000000030");
const two = submissionIdSchema.parse("c5000000-0000-4000-8000-000000000031");
const three = submissionIdSchema.parse("c5000000-0000-4000-8000-000000000032");
const missingSubmission = submissionIdSchema.parse("c5000000-0000-4000-8000-000000000039");
const missingReviewer = userIdSchema.parse("c5000000-0000-4000-8000-000000000029");

const formId = formIdSchema.parse("c5000000-0000-4000-8000-000000000050");
const abstractSection = sectionIdSchema.parse("c5000000-0000-4000-8000-000000000051");
const participantSection = sectionIdSchema.parse("c5000000-0000-4000-8000-000000000052");
const titleField = fieldIdSchema.parse("c5000000-0000-4000-8000-000000000060");
const approachField = fieldIdSchema.parse("c5000000-0000-4000-8000-000000000061");
const employerField = fieldIdSchema.parse("c5000000-0000-4000-8000-000000000062");
const emailField = fieldIdSchema.parse("c5000000-0000-4000-8000-000000000063");

/**
 * A pinned snapshot with one question of each classification: a locked identity
 * field, a custom field an organizer explicitly opened to blind reviewers, and a
 * custom field left at the fail-closed default.
 */
const SNAPSHOT: FormSnapshot = {
  formId,
  version: 1,
  context: "cfp",
  sections: [
    {
      id: abstractSection,
      key: "abstract",
      title: "Your proposal",
      pageHeading: "Proposal",
      descriptionHtml: "",
      fields: [
        {
          id: titleField, key: "title", label: "Title", type: "text", required: true, locked: true,
          maxChars: 255, helpText: "", options: [], visibility: null, mapsTo: "submission.title",
          reviewVisibility: "identity",
        },
        {
          id: approachField, key: "approach", label: "Approach", type: "textarea", required: false, locked: false,
          maxChars: null, helpText: "", options: [], visibility: null, mapsTo: null,
          reviewVisibility: "content",
        },
      ],
    },
    {
      id: participantSection,
      key: "participant",
      title: "About you",
      pageHeading: "About you",
      descriptionHtml: "",
      fields: [
        {
          id: employerField, key: "employer", label: "Employer", type: "text", required: false, locked: false,
          maxChars: null, helpText: "", options: [], visibility: null, mapsTo: null,
          // Left at the fail-closed default on purpose: this is the answer a
          // blind reviewer must not see.
          reviewVisibility: "identity",
        },
        {
          id: emailField, key: "email", label: "Email", type: "email", required: true, locked: true,
          maxChars: null, helpText: "", options: [], visibility: null, mapsTo: "contact.email",
          reviewVisibility: "identity",
        },
      ],
    },
  ],
};

let pglite: PGlite;
let db: DbOrTx;
let runEvaluationTransaction: <T>(work: (tx: DbOrTx) => Promise<T>) => Promise<T>;

/**
 * Enough environment to render an email, and no more: the reminder's queue link
 * is built from `APP_BASE_URL`, and every non-essential send needs the
 * unsubscribe secret.
 */
const mailEnv = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: "review-operations-secret-at-least-32-bytes",
  UNSUBSCRIBE_SECRET: "review-operations-unsubscribe-secret-32b",
  EMAIL_MODE: "log",
});

const REMINDER_ATTEMPT_A = "c4200000-0000-4000-8009-000000000001";
const REMINDER_ATTEMPT_B = "c4200000-0000-4000-8009-000000000002";

const AT_OPEN = new Date("2026-09-01T17:00:00.000Z");
const BEFORE_OPEN = new Date("2026-08-31T17:00:00.000Z");
const AT_CLOSE = new Date("2026-09-10T17:00:00.000Z");
const AFTER_CLOSE = new Date("2026-09-11T17:00:00.000Z");

const plan = (overrides: Record<string, unknown> = {}) =>
  planInputSchema.parse({ name: "Round 1", round: 1, scaleMin: 1, scaleMax: 5, ...overrides });

async function seedPlan(overrides: Record<string, unknown> = {}): Promise<PlanId> {
  const { planId } = await savePlanIn(runEvaluationTransaction, eventId, plan(overrides));
  return planId;
}

describe("review operations", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    for (const migration of MIGRATIONS) await pglite.exec(migration);
    const database = drizzle(pglite, { schema });
    db = database as unknown as DbOrTx;
    runEvaluationTransaction = (work) => database.transaction((tx) => work(tx as unknown as DbOrTx));

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Review ops','review-ops','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,'Platforms')", [platforms, eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,'AI Agents')", [agents, eventId]);

    for (const [id, email, name, role] of [
      [ada, "ada@example.com", "Ada Lovelace", "reviewer"],
      [grace, "grace@example.com", "Grace Hopper", "reviewer"],
      [organizer, "org@example.com", "Olive Organizer", "organizer"],
    ] as const) {
      await pglite.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [id, email, name]);
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,$3)", [id, eventId, role]);
    }

    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name,company) VALUES($1,$2,'author@example.com','Alex','Author','Acme Robotics')", [author, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'co@example.com','Casey','Coauthor')", [coAuthor, eventId]);
    // Ada reviews *and* has a contact row in this event, which is what a review
    // reminder is addressed to.
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ada@example.com','Ada','Lovelace')", [adaContact, eventId]);

    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,current_version) VALUES($1,$2,'cfp','CFP','open',1)",
      [formId, eventId],
    );
    await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3::jsonb)", [eventId, formId, JSON.stringify(SNAPSHOT)]);
    // The live rows the answers' foreign keys point at. The snapshot above is
    // what blindness reads; these only have to exist.
    for (const [sectionId, key, order] of [[abstractSection, "abstract", 0], [participantSection, "participant", 1]] as const) {
      await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key,sort_order) VALUES($1,$2,$3,$4,$5)", [sectionId, eventId, formId, key, order]);
    }
    for (const [fieldId, sectionId, key, type, visibility] of [
      [titleField, abstractSection, "title", "text", "identity"],
      [approachField, abstractSection, "approach", "textarea", "content"],
      [employerField, participantSection, "employer", "text", "identity"],
      [emailField, participantSection, "email", "email", "identity"],
    ] as const) {
      await pglite.query(
        "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,review_visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [fieldId, eventId, formId, sectionId, key, key, type, visibility],
      );
    }

    for (const [id, code, title, trackId] of [
      [one, 1, "Caching at the edge", platforms],
      [two, 2, "Agents that ship", agents],
      [three, 3, "Everything else", platforms],
    ] as const) {
      await pglite.query(
        `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,source,title,track_id,submitter_contact_id,submitted_at)
         VALUES($1,$2,$3,1,$4,'pending','cfp',$5,$6,$7, now())`,
        [id, eventId, formId, code, title, trackId, author],
      );
      await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventId, id, author]);
      await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)", [eventId, id, coAuthor]);
    }

    for (const [fieldId, value] of [
      [titleField, { t: "s", v: "Caching at the edge" }],
      [approachField, { t: "s", v: "A live rebuild of a CDN cache in 30 minutes" }],
      [employerField, { t: "s", v: "Acme Robotics" }],
      [emailField, { t: "s", v: "author@example.com" }],
    ] as const) {
      await pglite.query(
        "INSERT INTO submission_answers(event_id,submission_id,field_id,value) VALUES($1,$2,$3,$4::jsonb)",
        [eventId, one, fieldId, JSON.stringify(value)],
      );
    }
  });

  beforeEach(async () => {
    await pglite.exec("TRUNCATE reviews, review_assignments, reviewer_assignments, evaluation_criteria, evaluation_plans, communication_logs CASCADE");
  });

  it("keeps two rounds' windows, pools, score visibility, anonymization and typed criteria across a reload", async () => {
    const roundOne = await seedPlan({
      name: "Round 1",
      round: 1,
      opensAt: "2026-09-01T17:00:00.000Z",
      closesAt: "2026-09-10T17:00:00.000Z",
      anonymizeAuthors: false,
      showPeerScores: false,
      trackIds: [platforms],
      criteria: [{ label: "Relevance", weight: 2, kind: "numeric", required: true, minValue: 2, maxValue: 5 }],
    });
    const roundTwo = await seedPlan({
      name: "Round 2",
      round: 2,
      opensAt: "2026-09-11T17:00:00.000Z",
      closesAt: "2026-09-20T17:00:00.000Z",
      anonymizeAuthors: true,
      showPeerScores: true,
      criteria: [
        { label: "Originality", weight: 3, kind: "numeric", required: true },
        {
          label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "yes", label: "Accept", score: 5 }, { id: "abstain", label: "Abstain", score: null }],
        },
        { label: "Notes", weight: 1, kind: "text", required: false },
      ],
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, roundOne, [{ userId: ada, trackIds: [platforms] }]);
    await assignReviewersIn(runEvaluationTransaction, eventId, roundTwo, [{ userId: grace, trackIds: null }]);

    const reloadedOne = await getPlanIn(db, eventId, roundOne);
    expect(reloadedOne.opensAt).toBe("2026-09-01T17:00:00.000Z");
    expect(reloadedOne.closesAt).toBe("2026-09-10T17:00:00.000Z");
    expect(reloadedOne.anonymizeAuthors).toBe(false);
    expect(reloadedOne.showPeerScores).toBe(false);
    expect(reloadedOne.criteria[0]).toMatchObject({ kind: "numeric", required: true, minValue: 2, maxValue: 5, weight: 2 });
    expect(reloadedOne.reviewers.map((reviewer) => reviewer.userId)).toEqual([ada]);

    const reloadedTwo = await getPlanIn(db, eventId, roundTwo);
    expect(reloadedTwo.anonymizeAuthors).toBe(true);
    expect(reloadedTwo.showPeerScores).toBe(true);
    expect(reloadedTwo.criteria.map((criterion) => criterion.kind)).toEqual(["numeric", "select", "text"]);
    expect(reloadedTwo.criteria[1]?.options).toEqual([
      { id: "yes", label: "Accept", score: 5 },
      { id: "abstain", label: "Abstain", score: null },
    ]);
    expect(reloadedTwo.criteria[2]?.required).toBe(false);
    expect(reloadedTwo.reviewers.map((reviewer) => reviewer.userId)).toEqual([grace]);
  });

  it("refuses a window that closes before it opens, and options outside the round's scale", async () => {
    const backwards = plan.bind(null);
    expect(() => backwards({ opensAt: "2026-09-10T17:00:00.000Z", closesAt: "2026-09-01T17:00:00.000Z" })).toThrow();

    const outOfScale = await savePlanIn(runEvaluationTransaction, eventId, plan({
      name: "Out of scale",
      criteria: [{ label: "Recommendation", kind: "select", options: [{ id: "yes", label: "Accept", score: 9 }] }],
    })).catch((thrown: unknown) => thrown);
    expect(isAppError(outOfScale) && outOfScale.code).toBe("VALIDATION");
  });

  it("opens the window at opens_at, shuts saves at closes_at, and keeps prior work readable after", async () => {
    const planId = await seedPlan({
      opensAt: AT_OPEN.toISOString(),
      closesAt: AT_CLOSE.toISOString(),
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);

    // Before the window there is nothing to read at all.
    const early = await listReviewQueueIn(db, eventId, ada, planId, BEFORE_OPEN);
    expect(early.rows).toEqual([]);
    expect(early.window).toMatchObject({ state: "before_open", canRead: false, canSave: false });
    const earlyDetail = await getReviewerSubmissionDetailIn(db, eventId, planId, one, ada, BEFORE_OPEN)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(earlyDetail) && earlyDetail.code).toBe("FORBIDDEN");
    const earlySave = await submitReviewIn(db, eventId, planId, one, ada, verdict({ overallScore: 4 }), BEFORE_OPEN)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(earlySave) && earlySave.code).toBe("CONFLICT");

    // The window is half-open, so the instant it opens is inside it.
    const saved = await submitReviewIn(db, eventId, planId, one, ada, verdict({ overallScore: 4 }), AT_OPEN);
    expect(saved.overallScore).toBe(4);

    // …and the instant it closes is outside it.
    const atClose = await submitReviewIn(db, eventId, planId, one, ada, verdict({ overallScore: 5 }), AT_CLOSE)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(atClose) && atClose.code).toBe("CONFLICT");

    const afterClose = await listReviewQueueIn(db, eventId, ada, planId, AFTER_CLOSE);
    expect(afterClose.window).toMatchObject({ state: "closed", canRead: true, canSave: false });
    expect(afterClose.rows.find((row) => row.submissionId === one)?.myScore).toBe(4);
    await expect(getReviewerSubmissionDetailIn(db, eventId, planId, one, ada, AFTER_CLOSE)).resolves.toMatchObject({ submissionId: one });
  });

  it("gives a reviewer exactly their assigned submissions and refuses the rest", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    await assignSubmissionsIn(runEvaluationTransaction, eventId, { planId, reviewerUserIds: [ada], submissionIds: [one, two], mode: "replace" });

    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    expect(queue.rows.map((row) => row.submissionId).sort()).toEqual([one, two].sort());

    const forbidden = await getReviewerSubmissionDetailIn(db, eventId, planId, three, ada)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(forbidden) && forbidden.code).toBe("FORBIDDEN");
    const refusedSave = await submitReviewIn(db, eventId, planId, three, ada, verdict({ overallScore: 4 }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(refusedSave) && refusedSave.code).toBe("FORBIDDEN");
  });

  it.each(["manual", "deadline"] as const)(
    "keeps add and replace queue mutations atomic after a %s close",
    async (closure) => {
      const planId = await seedPlan();
      await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
      await assignSubmissionsIn(runEvaluationTransaction, eventId, {
        planId,
        reviewerUserIds: [ada],
        submissionIds: [one],
        mode: "replace",
      });

      const lockedInput = closure === "manual"
        ? { status: "closed" as const, closesAt: null }
        : { status: "open" as const, closesAt: new Date(Date.now() - 60_000).toISOString() };
      await savePlanIn(runEvaluationTransaction, eventId, plan({ planId, ...lockedInput }));
      const rows = async () => (await pglite.query(
        "SELECT submission_id, reviewer_user_id, status FROM review_assignments WHERE plan_id=$1 ORDER BY submission_id, reviewer_user_id",
        [planId],
      )).rows;
      const before = await rows();

      for (const attempted of [
        { submissionIds: [two], mode: "add" as const },
        { submissionIds: [two], mode: "replace" as const },
      ]) {
        const error = await assignSubmissionsIn(runEvaluationTransaction, eventId, {
          planId,
          reviewerUserIds: [ada],
          ...attempted,
        }).catch((thrown: unknown) => thrown);
        expect(isAppError(error) && error.code).toBe("CONFLICT");
        expect(await rows()).toEqual(before);
      }

      const writableInput = closure === "manual"
        ? { status: "open" as const, closesAt: null }
        : { status: "open" as const, closesAt: new Date(Date.now() + 60 * 60_000).toISOString() };
      await savePlanIn(runEvaluationTransaction, eventId, plan({ planId, ...writableInput }));
      await expect(assignSubmissionsIn(runEvaluationTransaction, eventId, {
        planId,
        reviewerUserIds: [ada],
        submissionIds: [two],
        mode: "add",
      })).resolves.toMatchObject({ assigned: 1, removed: 0 });
      expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId).sort())
        .toEqual([one, two].sort());
    },
  );

  /** PostgreSQL keeps a statement snapshot after a FOR UPDATE wait. The lock
   * and mutation must therefore be separate statements in one transaction. */
  it("locks before taking the reviewer and queue mutation snapshots", async () => {
    const dialect = new PgDialect();
    const statements: { sql: string; params: unknown[] }[] = [];
    const capturing = {
      execute: async (query: unknown) => {
        statements.push(dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]));
        return {
          rows: [{ writable: true, matched: 1, reviewers: 1, submissions: 1, assigned: 1, removed: 0 }],
        };
      },
    } as unknown as DbOrTx;
    let transactions = 0;
    const capturingTransaction = async <T>(work: (tx: DbOrTx) => Promise<T>) => {
      transactions += 1;
      return work(capturing);
    };

    const planId = await seedPlan();
    await assignReviewersIn(capturingTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    await assignSubmissionsIn(capturingTransaction, eventId, {
      planId,
      reviewerUserIds: [ada],
      submissionIds: [one],
      mode: "add",
    });
    expect(transactions).toBe(2);
    expect(statements).toHaveLength(4);

    for (const statement of [statements[0], statements[2]]) {
      expect(statement).toBeDefined();
      if (!statement) continue;
      expect(statement.sql).toMatch(/for update/iu);
      expect(statement.sql).toMatch(/clock_timestamp\(\)/iu);
      expect(statement.sql).not.toMatch(/current_timestamp/iu);
      const inlined = statement.sql.replace(/\$(\d+)/gu, (_match, index: string) => {
        const value = String(statement.params[Number(index) - 1]).replaceAll("'", "''");
        return `'${value}'`;
      });
      const plan = await pglite.query<{ "QUERY PLAN": string }>(`EXPLAIN ${inlined}`);
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("LockRows");
    }
    for (const statement of [statements[1], statements[3]]) {
      expect(statement?.sql).not.toMatch(/for update/iu);
      expect(statement?.sql).toMatch(/review_assignments|reviewer_assignments/iu);
    }
  });

  it("replaces from the state committed before its plan lock and rejects a close that wins first", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);

    const afterCompetingCommit = (compete: () => Promise<void>) => async <T>(work: (tx: DbOrTx) => Promise<T>) => {
      let beforeLock = true;
      const intercepted = {
        execute: async (query: unknown) => {
          if (beforeLock) {
            beforeLock = false;
            await compete();
          }
          return db.execute(query as Parameters<DbOrTx["execute"]>[0]);
        },
      } as unknown as DbOrTx;
      return work(intercepted);
    };

    await assignReviewersIn(afterCompetingCommit(() => assignReviewersIn(
      runEvaluationTransaction,
      eventId,
      planId,
      [{ userId: ada, trackIds: null }, { userId: grace, trackIds: null }],
    )), eventId, planId, [{ userId: grace, trackIds: null }]);
    expect((await getPlanIn(db, eventId, planId)).reviewers.map((reviewer) => reviewer.userId)).toEqual([grace]);

    await assignSubmissionsIn(afterCompetingCommit(() => assignSubmissionsIn(
      runEvaluationTransaction,
      eventId,
      { planId, reviewerUserIds: [grace], submissionIds: [one, two], mode: "replace" },
    ).then(() => undefined)), eventId, {
      planId,
      reviewerUserIds: [grace],
      submissionIds: [three],
      mode: "replace",
    });
    expect((await listReviewQueueIn(db, eventId, grace, planId)).rows.map((row) => row.submissionId)).toEqual([three]);

    const beforeClose = await pglite.query(
      "SELECT submission_id, reviewer_user_id FROM review_assignments WHERE plan_id=$1 ORDER BY submission_id, reviewer_user_id",
      [planId],
    );
    const rejected = await assignSubmissionsIn(afterCompetingCommit(async () => {
      await savePlanIn(runEvaluationTransaction, eventId, plan({ planId, status: "closed" }));
    }), eventId, {
      planId,
      reviewerUserIds: [grace],
      submissionIds: [one],
      mode: "add",
    }).catch((error: unknown) => error);
    expect(isAppError(rejected) && rejected.code).toBe("CONFLICT");
    expect((await pglite.query(
      "SELECT submission_id, reviewer_user_id FROM review_assignments WHERE plan_id=$1 ORDER BY submission_id, reviewer_user_id",
      [planId],
    )).rows).toEqual(beforeClose.rows);
  });

  it("narrows from the assignment graph committed before its plan lock", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    await assignSubmissionsIn(runEvaluationTransaction, eventId, {
      planId,
      reviewerUserIds: [ada],
      submissionIds: [one],
      mode: "replace",
    });

    const dialect = new PgDialect();
    const statements: string[] = [];
    let competingAssignmentCommitted = false;
    const rescopeAfterAssignment = async <T>(work: (tx: DbOrTx) => Promise<T>) => {
      const intercepted = {
        execute: async (query: unknown) => {
          const statement = dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]);
          statements.push(statement.sql);
          if (!competingAssignmentCommitted && /for update/iu.test(statement.sql)) {
            competingAssignmentCommitted = true;
            await assignSubmissionsIn(runEvaluationTransaction, eventId, {
              planId,
              reviewerUserIds: [ada],
              submissionIds: [two],
              mode: "add",
            });
          }
          return db.execute(query as Parameters<DbOrTx["execute"]>[0]);
        },
      } as unknown as DbOrTx;
      return work(intercepted);
    };

    await savePlanIn(rescopeAfterAssignment, eventId, plan({ planId, trackIds: [platforms] }));
    const lockIndex = statements.findIndex((statement) => /for update/iu.test(statement));
    const mutationIndex = statements.findIndex((statement) => /with\s+saved\s+as/iu.test(statement));
    expect(competingAssignmentCommitted).toBe(true);
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(mutationIndex).toBeGreaterThan(lockIndex);
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId)).toEqual([one]);

    const outOfScope = await assignSubmissionsIn(runEvaluationTransaction, eventId, {
      planId,
      reviewerUserIds: [ada],
      submissionIds: [two],
      mode: "add",
    }).catch((error: unknown) => error);
    expect(isAppError(outOfScope) && outOfScope.code).toBe("VALIDATION");

    const narrowed = await getPlanIn(db, eventId, planId);
    let competingCloseCommitted = false;
    const widenAfterClose = async <T>(work: (tx: DbOrTx) => Promise<T>) => {
      const intercepted = {
        execute: async (query: unknown) => {
          const statement = dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]);
          if (!competingCloseCommitted && /for update/iu.test(statement.sql)) {
            competingCloseCommitted = true;
            await savePlanIn(runEvaluationTransaction, eventId, plan({
              planId,
              status: "closed",
              trackIds: [platforms],
            }));
            await pglite.query("UPDATE evaluation_plans SET updated_at=updated_at + interval '1 second' WHERE id=$1", [planId]);
          }
          return db.execute(query as Parameters<DbOrTx["execute"]>[0]);
        },
      } as unknown as DbOrTx;
      return work(intercepted);
    };
    const staleWiden = await savePlanIn(widenAfterClose, eventId, plan({
      planId,
      status: "open",
      trackIds: [platforms, agents],
    }), narrowed.updatedAt).catch((error: unknown) => error);
    expect(competingCloseCommitted).toBe(true);
    expect(isAppError(staleWiden) && staleWiden.code).toBe("STALE_WRITE");
    expect(await getPlanIn(db, eventId, planId)).toMatchObject({ status: "closed", trackIds: [platforms] });
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId)).toEqual([one]);
  });

  it("allows explicit queues to be prepared before the round opens", async () => {
    const planId = await seedPlan({
      opensAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      closesAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);

    await expect(assignSubmissionsIn(runEvaluationTransaction, eventId, {
      planId,
      reviewerUserIds: [ada],
      submissionIds: [one],
      mode: "replace",
    })).resolves.toMatchObject({ assigned: 0, removed: 2 });
    expect((await listReviewQueueIn(db, eventId, ada, planId, new Date(Date.now() + 90 * 60_000))).rows.map((row) => row.submissionId))
      .toEqual([one]);
  });

  it("leaves queues unchanged when a replacement contains a stale submission", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    await assignSubmissionsIn(runEvaluationTransaction, eventId, { planId, reviewerUserIds: [ada], submissionIds: [one], mode: "replace" });

    const rejected = await assignSubmissionsIn(runEvaluationTransaction, eventId, {
      planId,
      reviewerUserIds: [ada],
      submissionIds: [two, missingSubmission],
      mode: "replace",
    }).catch((thrown: unknown) => thrown);

    expect(isAppError(rejected) && rejected.code).toBe("VALIDATION");
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId)).toEqual([one]);
  });

  it("leaves queues unchanged when a replacement names a reviewer outside the round", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    await assignSubmissionsIn(runEvaluationTransaction, eventId, { planId, reviewerUserIds: [ada], submissionIds: [one], mode: "replace" });

    const rejected = await assignSubmissionsIn(runEvaluationTransaction, eventId, {
      planId,
      reviewerUserIds: [ada, missingReviewer],
      submissionIds: [two],
      mode: "replace",
    }).catch((thrown: unknown) => thrown);

    expect(isAppError(rejected) && rejected.code).toBe("VALIDATION");
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId)).toEqual([one]);
  });

  it("keeps the committee roster out of a reviewer's own payload", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }, { userId: grace, trackIds: null }]);
    await assignSubmissionsIn(runEvaluationTransaction, eventId, { planId, reviewerUserIds: [ada], submissionIds: [one], mode: "replace" });

    // The organizer's own page is what per-reviewer progress is for.
    const organizerView = await getPlanIn(db, eventId, planId);
    expect(organizerView.reviewers.map((reviewer) => reviewer.email).sort())
      .toEqual(["ada@example.com", "grace@example.com"]);

    // The reviewer's copy carries the round's governance and scorecard and
    // nothing about who else is on the committee — it is rendered by a client
    // component, so anything in it is something a reviewer can read.
    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    expect(queue.plan?.reviewers).toEqual([]);
    expect(queue.plan?.criteria.length).toBe(organizerView.criteria.length);
    const mine = await listReviewerPlansIn(db, eventId, ada);
    expect(mine.map((plan) => plan.id)).toEqual([planId]);
    expect(mine.flatMap((plan) => plan.reviewers)).toEqual([]);
    // Somebody with no round at all gets no round list, rather than the event's.
    expect(await listReviewerPlansIn(db, eventId, organizer)).toEqual([]);
  });

  it("builds a blind DTO from the pinned snapshot and leaves the organizer's complete", async () => {
    const planId = await seedPlan({ anonymizeAuthors: true });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);

    const blind = await getReviewerSubmissionDetailIn(db, eventId, planId, one, ada);
    expect(blind.submitterName).toBeNull();
    expect(blind.submitterEmail).toBeNull();
    expect(blind.speakers).toEqual([]);
    expect(blind.participants).toEqual([]);
    expect(blind.answerPanel.participants).toEqual([]);
    const blindFieldIds = blind.answerPanel.answers.map((answer) => answer.fieldId);
    // Explicitly marked as proposal content.
    expect(blindFieldIds).toContain(approachField);
    // Left at the fail-closed default, and a locked identity field.
    expect(blindFieldIds).not.toContain(employerField);
    expect(blindFieldIds).not.toContain(emailField);
    expect(blind.answerPanel.snapshot?.sections.flatMap((section) => section.fields).map((field) => field.id))
      .toEqual([approachField]);

    // The same round, read by an organizer, is untouched.
    const openPlan = await seedPlan({ name: "Round 1 open", anonymizeAuthors: false });
    await assignReviewersIn(runEvaluationTransaction, eventId, openPlan, [{ userId: ada, trackIds: null }]);
    const full = await getReviewerSubmissionDetailIn(db, eventId, openPlan, one, ada);
    expect(full.submitterName).not.toBeNull();
    expect(full.participants.length).toBe(2);
    expect(full.answerPanel.answers.map((answer) => answer.fieldId).sort())
      .toEqual([titleField, approachField, employerField, emailField].sort());
  });

  it("round-trips all three criterion kinds and lets required values govern completion", async () => {
    const planId = await seedPlan({
      criteria: [
        { label: "Originality", weight: 3, kind: "numeric", required: true },
        {
          label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "accept", label: "Accept", score: 5 }, { id: "abstain", label: "Abstain", score: null }],
        },
        { label: "Notes", weight: 1, kind: "text", required: false },
      ],
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const criteria = (await getPlanIn(db, eventId, planId)).criteria;
    const [originality, recommendation, notes] = criteria;

    // One required criterion missing: saved, but unfinished and unrated.
    const partial = await submitReviewIn(db, eventId, planId, one, ada, verdict({
      criterionScores: { [originality?.id ?? ""]: { kind: "numeric", value: 4 } },
    }));
    expect(partial.complete).toBe(false);
    expect(partial.overallScore).toBeNull();
    expect((await getRatingsIn(db, eventId, planId)).has(one)).toBe(false);

    // Both required criteria answered: (4×3 + 5×1) / 4 = 4.25. The optional text
    // answer is stored and stays out of the arithmetic entirely.
    const complete = await submitReviewIn(db, eventId, planId, one, ada, verdict({
      criterionScores: {
        [originality?.id ?? ""]: { kind: "numeric", value: 4 },
        [recommendation?.id ?? ""]: { kind: "select", optionId: "accept" },
        [notes?.id ?? ""]: { kind: "text", value: "Would attend" },
      },
    }));
    expect(complete.complete).toBe(true);
    expect(complete.overallScore).toBe(4.25);

    const reloaded = (await listReviewQueueIn(db, eventId, ada, planId)).rows.find((row) => row.submissionId === one);
    expect(reloaded?.myCriterionValues).toEqual({
      [originality?.id ?? ""]: { kind: "numeric", value: 4 },
      [recommendation?.id ?? ""]: { kind: "select", optionId: "accept" },
      [notes?.id ?? ""]: { kind: "text", value: "Would attend" },
    });
    expect(reloaded?.scoredAt).not.toBeNull();

    // An unscored choice is a real answer that never moves the mean: with only
    // "Abstain" and the number, the weighted mean is the number alone.
    const abstained = await submitReviewIn(db, eventId, planId, two, ada, verdict({
      criterionScores: {
        [originality?.id ?? ""]: { kind: "numeric", value: 2 },
        [recommendation?.id ?? ""]: { kind: "select", optionId: "abstain" },
      },
    }));
    expect(abstained.complete).toBe(true);
    expect(abstained.overallScore).toBe(2);

    // A text-only round produces finished reviews with no score at all.
    const textOnly = await seedPlan({
      name: "Comments only",
      criteria: [{ label: "Notes", weight: 1, kind: "text", required: true }],
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, textOnly, [{ userId: ada, trackIds: null }]);
    const textCriterion = (await getPlanIn(db, eventId, textOnly)).criteria[0];
    const written = await submitReviewIn(db, eventId, textOnly, one, ada, verdict({
      criterionScores: { [textCriterion?.id ?? ""]: { kind: "text", value: "Needs a stronger demo" } },
    }));
    expect(written).toMatchObject({ complete: true, overallScore: null });
    expect((await getRatingsIn(db, eventId, textOnly)).has(one)).toBe(false);
  });

  it("retains attributed score revisions with their historical criterion labels", async () => {
    const planId = await seedPlan({
      criteria: [{ label: "Relevance", weight: 1, kind: "numeric", required: true }],
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const criterion = (await getPlanIn(db, eventId, planId)).criteria[0];
    const firstVerdict = verdict({
      criterionScores: { [criterion?.id ?? ""]: { kind: "numeric", value: 3 } },
      comment: "Promising, but narrow",
    });

    await submitReviewIn(db, eventId, planId, one, ada, firstVerdict, AT_OPEN);
    // A lost-response retry preserves the original completion time and does not
    // pretend the same verdict was a new historical decision.
    await submitReviewIn(db, eventId, planId, one, ada, firstVerdict, new Date(AT_OPEN.getTime() + 60_000));
    expect(await listReviewHistoryIn(db, eventId, one)).toHaveLength(1);

    await savePlanIn(runEvaluationTransaction, eventId, plan({
      planId,
      criteria: [{
        id: criterion?.id,
        label: "Program fit",
        weight: 1,
        kind: "numeric",
        required: true,
      }],
    }));
    await submitReviewIn(db, eventId, planId, one, ada, verdict({
      criterionScores: { [criterion?.id ?? ""]: { kind: "numeric", value: 5 } },
      comment: "Strong fit after the program changed",
    }), new Date(AT_OPEN.getTime() + 120_000));

    const history = await listReviewHistoryIn(db, eventId, one);
    expect(history.map((entry) => entry.revision)).toEqual([2, 1]);
    expect(history[0]).toMatchObject({
      planName: "Round 1",
      reviewerName: "Ada Lovelace",
      reviewerEmail: "ada@example.com",
      overallScore: 5,
      complete: true,
      answers: [{ label: "Program fit", value: "5" }],
      comment: "Strong fit after the program changed",
    });
    expect(history[1]).toMatchObject({
      overallScore: 3,
      answers: [{ label: "Relevance", value: "3" }],
      comment: "Promising, but narrow",
    });
    expect(await listReviewHistoryIn(
      db,
      eventIdSchema.parse("c5000000-0000-4000-8000-000000000099"),
      one,
    )).toEqual([]);
  });

  it("rejects a value of the wrong kind, an unknown option, and a number outside its bounds", async () => {
    const planId = await seedPlan({
      criteria: [
        { label: "Originality", weight: 1, kind: "numeric", required: true, minValue: 2, maxValue: 4 },
        { label: "Recommendation", weight: 1, kind: "select", required: true, options: [{ id: "accept", label: "Accept", score: 5 }] },
      ],
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const [originality, recommendation] = (await getPlanIn(db, eventId, planId)).criteria;

    for (const values of [
      { [originality?.id ?? ""]: { kind: "numeric" as const, value: 5 } },
      { [originality?.id ?? ""]: { kind: "text" as const, value: "four" } },
      { [recommendation?.id ?? ""]: { kind: "select" as const, optionId: "nope" } },
    ]) {
      const error = await submitReviewIn(db, eventId, planId, one, ada, verdict({ criterionScores: values }))
        .catch((thrown: unknown) => thrown);
      expect(isAppError(error) && error.code).toBe("VALIDATION");
    }
  });

  it("reads M19's bare numbers as numeric values without a second answer store", async () => {
    const planId = await seedPlan({ criteria: [{ label: "Relevance", weight: 1 }] });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const criterion = (await getPlanIn(db, eventId, planId)).criteria[0];

    // Exactly the payload M19 wrote, straight into the same column.
    await pglite.query(
      `INSERT INTO reviews(event_id,plan_id,submission_id,reviewer_user_id,overall_score,criterion_scores,submitted_at)
       VALUES($1,$2,$3,$4,4,$5::jsonb, now())`,
      [eventId, planId, one, ada, JSON.stringify({ [criterion?.id ?? ""]: 4 })],
    );

    const row = (await listReviewQueueIn(db, eventId, ada, planId)).rows.find((entry) => entry.submissionId === one);
    expect(row?.myCriterionValues).toEqual({ [criterion?.id ?? ""]: { kind: "numeric", value: 4 } });
    expect(row?.myCriterionScores).toEqual({ [criterion?.id ?? ""]: 4 });
  });

  it("reports assigned, completed and recused per reviewer, and keeps a recusal auditable", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [
      { userId: ada, trackIds: null },
      { userId: grace, trackIds: null },
    ]);
    await submitReviewIn(db, eventId, planId, one, ada, verdict({ overallScore: 4 }));
    await recuseAssignmentIn(db, eventId, planId, two, ada, "I work with one of the authors");

    const progress = await getPlanIn(db, eventId, planId);
    const adaProgress = progress.reviewers.find((reviewer) => reviewer.userId === ada);
    expect(adaProgress).toMatchObject({ assigned: 2, completed: 1, recused: 1, outstanding: 1 });
    expect(progress.reviewers.find((reviewer) => reviewer.userId === grace))
      .toMatchObject({ assigned: 3, completed: 0, recused: 0, outstanding: 3 });

    // Recused work leaves the queue…
    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    expect(queue.rows.map((row) => row.submissionId)).not.toContain(two);
    const refused = await submitReviewIn(db, eventId, planId, two, ada, verdict({ overallScore: 5 }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(refused) && refused.code).toBe("CONFLICT");

    // …and survives the reassignment of the same abstract to somebody else.
    await assignSubmissionsIn(runEvaluationTransaction, eventId, { planId, reviewerUserIds: [grace], submissionIds: [two], mode: "add" });
    const audit = await pglite.query<{ status: string; recusal_reason: string; recused_at: string | null }>(
      "SELECT status, recusal_reason, recused_at FROM review_assignments WHERE plan_id=$1 AND submission_id=$2 AND reviewer_user_id=$3",
      [planId, two, ada],
    );
    expect(audit.rows[0]?.status).toBe("recused");
    expect(audit.rows[0]?.recusal_reason).toBe("I work with one of the authors");
    expect(audit.rows[0]?.recused_at).not.toBeNull();

    // A bulk "replace" must not resurrect it either.
    await assignSubmissionsIn(runEvaluationTransaction, eventId, { planId, reviewerUserIds: [ada], submissionIds: [one, two, three], mode: "replace" });
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId)).not.toContain(two);
  });

  it("keeps a recusal when the reviewer who declared it is taken off the round", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [
      { userId: ada, trackIds: null },
      { userId: grace, trackIds: null },
    ]);
    await recuseAssignmentIn(db, eventId, planId, two, ada, "I share an employer with the author");

    // Removing a reviewer from a round is the move most likely to *follow* a
    // recusal, so it is the one that must not erase the reason it happened.
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: grace, trackIds: null }]);

    const remaining = await pglite.query<{ status: string; recusal_reason: string | null; recused_at: string | null }>(
      "SELECT status, recusal_reason, recused_at FROM review_assignments WHERE plan_id=$1 AND reviewer_user_id=$2",
      [planId, ada],
    );
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0]).toMatchObject({ status: "recused", recusal_reason: "I share an employer with the author" });
    expect(remaining.rows[0]?.recused_at).not.toBeNull();

    // The audit row is not a queue row: Ada is off the round, so she sees
    // nothing and the plan no longer counts her among its reviewers.
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows).toEqual([]);
    expect((await getPlanIn(db, eventId, planId)).reviewers.map((reviewer) => reviewer.userId)).toEqual([grace]);

    // …and putting her back does not hand her the abstract she stepped away from.
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [
      { userId: ada, trackIds: null },
      { userId: grace, trackIds: null },
    ]);
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId)).not.toContain(two);
    const stillRecused = await pglite.query<{ status: string }>(
      "SELECT status FROM review_assignments WHERE plan_id=$1 AND submission_id=$2 AND reviewer_user_id=$3",
      [planId, two, ada],
    );
    expect(stillRecused.rows[0]?.status).toBe("recused");
  });

  it("narrows every reviewer's queue when the round's track scope narrows", async () => {
    const planId = await seedPlan({ trackIds: null });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [
      { userId: ada, trackIds: null },
      { userId: grace, trackIds: null },
    ]);
    // Grace stepped away from the AI Agents proposal; Ada still holds it.
    await recuseAssignmentIn(db, eventId, planId, two, grace, "Conflicted on the agents track");
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId).sort())
      .toEqual([one, two, three].sort());

    // Restricting the round to Platforms is how an organizer stops reviewers
    // seeing the AI Agents track. The queue is the assignment row, so it has to
    // move with the scope — the plan's own progress and the assignable pool
    // already do.
    await savePlanIn(runEvaluationTransaction, eventId, plan({ planId, trackIds: [platforms] }));

    const narrowed = await listReviewQueueIn(db, eventId, ada, planId);
    expect(narrowed.rows.map((row) => row.submissionId).sort()).toEqual([one, three].sort());
    const outOfScope = await getReviewerSubmissionDetailIn(db, eventId, planId, two, ada)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(outOfScope) && outOfScope.code).toBe("FORBIDDEN");
    const refusedSave = await submitReviewIn(db, eventId, planId, two, ada, verdict({ overallScore: 5 }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(refusedSave) && refusedSave.code).toBe("FORBIDDEN");

    // The organizer's round and the reviewers' queues report the same pool.
    const rescoped = await getPlanIn(db, eventId, planId);
    expect(rescoped.progress.total).toBe(2);
    expect(rescoped.reviewers.find((reviewer) => reviewer.userId === ada)?.assigned).toBe(2);
    expect((await listAssignableSubmissionsIn(db, eventId, planId)).map((row) => row.submissionId).sort())
      .toEqual([one, three].sort());

    // A rescope drops work, never the record of a decision.
    const audit = await pglite.query<{ status: string; recusal_reason: string | null }>(
      "SELECT status, recusal_reason FROM review_assignments WHERE plan_id=$1 AND submission_id=$2 AND reviewer_user_id=$3",
      [planId, two, grace],
    );
    expect(audit.rows[0]).toMatchObject({ status: "recused", recusal_reason: "Conflicted on the agents track" });

    // Widening again adds candidates, not queue rows: assignments stay explicit.
    await savePlanIn(runEvaluationTransaction, eventId, plan({ planId, trackIds: null }));
    expect((await listReviewQueueIn(db, eventId, ada, planId)).rows.map((row) => row.submissionId).sort())
      .toEqual([one, three].sort());
    expect((await listAssignableSubmissionsIn(db, eventId, planId)).map((row) => row.submissionId).sort())
      .toEqual([one, two, three].sort());
  });

  it("refuses to re-value a scored round through an option score or a numeric bound", async () => {
    const planId = await seedPlan({
      criteria: [
        { label: "Originality", weight: 1, kind: "numeric", required: true, minValue: 1, maxValue: 5 },
        {
          label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "accept", label: "Accept", score: 5 }, { id: "reject", label: "Reject", score: 1 }],
        },
      ],
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const [originality, recommendation] = (await getPlanIn(db, eventId, planId)).criteria;
    const scored = await submitReviewIn(db, eventId, planId, one, ada, verdict({
      criterionScores: {
        [originality?.id ?? ""]: { kind: "numeric", value: 3 },
        [recommendation?.id ?? ""]: { kind: "select", optionId: "accept" },
      },
    }));
    expect(scored.overallScore).toBe(4);

    const keep = (overrides: Record<string, unknown> = {}) => plan({
      planId,
      criteria: [
        { id: originality?.id, label: "Originality", weight: 1, kind: "numeric", required: true, minValue: 1, maxValue: 5 },
        {
          id: recommendation?.id, label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "accept", label: "Accept", score: 5 }, { id: "reject", label: "Reject", score: 1 }],
        },
      ],
      ...overrides,
    });

    // Re-scoring "Accept" from 5 to 1, or deleting the option a stored answer
    // names, would leave the review's stored 4 meaning nothing anybody chose.
    const rescored = await savePlanIn(runEvaluationTransaction, eventId, keep({
      criteria: [
        { id: originality?.id, label: "Originality", weight: 1, kind: "numeric", required: true, minValue: 1, maxValue: 5 },
        {
          id: recommendation?.id, label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "accept", label: "Accept", score: 1 }, { id: "reject", label: "Reject", score: 1 }],
        },
      ],
    })).catch((thrown: unknown) => thrown);
    expect(isAppError(rescored) && rescored.code).toBe("CONFLICT");

    const dropped = await savePlanIn(runEvaluationTransaction, eventId, keep({
      criteria: [
        { id: originality?.id, label: "Originality", weight: 1, kind: "numeric", required: true, minValue: 1, maxValue: 5 },
        {
          id: recommendation?.id, label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "accept", label: "Accept", score: 5 }],
        },
      ],
    })).catch((thrown: unknown) => thrown);
    expect(isAppError(dropped) && dropped.code).toBe("CONFLICT");

    const rebounded = await savePlanIn(runEvaluationTransaction, eventId, keep({
      criteria: [
        { id: originality?.id, label: "Originality", weight: 1, kind: "numeric", required: true, minValue: 3, maxValue: 5 },
        {
          id: recommendation?.id, label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "accept", label: "Accept", score: 5 }, { id: "reject", label: "Reject", score: 1 }],
        },
      ],
    })).catch((thrown: unknown) => thrown);
    expect(isAppError(rebounded) && rebounded.code).toBe("CONFLICT");

    // Presentation is still editable: a reworded option, a reordered choice
    // list, a renamed round and a closing date change no arithmetic.
    await savePlanIn(runEvaluationTransaction, eventId, keep({
      name: "Round 1 (renamed)",
      status: "closed",
      criteria: [
        { id: originality?.id, label: "Originality of the idea", weight: 1, kind: "numeric", required: true, minValue: 1, maxValue: 5 },
        {
          id: recommendation?.id, label: "Recommendation", weight: 1, kind: "select", required: true,
          options: [{ id: "reject", label: "Reject outright", score: 1 }, { id: "accept", label: "Strong accept", score: 5 }],
        },
      ],
    }));
    const reloaded = await getPlanIn(db, eventId, planId);
    expect(reloaded.name).toBe("Round 1 (renamed)");
    expect(reloaded.criteria[1]?.options.map((option) => option.id)).toEqual(["reject", "accept"]);
    expect((await getRatingsIn(db, eventId, planId)).get(one)?.rating).toBe(4);
  });

  it("enqueues one reminder per outstanding reviewer through the outbox, and only while the round is open", async () => {
    const planId = await seedPlan({
      opensAt: AT_OPEN.toISOString(),
      closesAt: AT_CLOSE.toISOString(),
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }, { userId: grace, trackIds: null }]);
    await submitReviewIn(db, eventId, planId, one, ada, verdict({ overallScore: 4 }), AT_OPEN);

    const outstanding = await listOutstandingReviewersIn(db, eventId, planId);
    expect(outstanding.map((target) => target.reviewerUserId).sort()).toEqual([ada, grace].sort());
    expect(outstanding.find((target) => target.reviewerUserId === ada)?.outstanding).toBe(2);
    // Ada has a same-email event contact, but the preview cannot infer that it
    // belongs to her. The send action below makes the relationship durable.
    expect(outstanding.find((target) => target.reviewerUserId === ada)?.contactId).toBeNull();

    const sent = await sendReviewRemindersIn(db, eventId, planId, null, REMINDER_ATTEMPT_A, AT_OPEN.getTime());
    // Grace is an existing event member with no contact row. Reminding the
    // round provisions that outbox identity instead of silently skipping her.
    expect(sent).toEqual({ enqueued: 2, skipped: 0 });

    const logs = await pglite.query<{ template_key: string; email: string; first_name: string; last_name: string; status: string }>(
      `SELECT l.template_key, c.email, c.first_name, c.last_name, l.status
       FROM communication_logs l JOIN contacts c ON c.id = l.contact_id
       WHERE l.event_id=$1 ORDER BY c.email`,
      [eventId],
    );
    expect(logs.rows).toEqual([
      { template_key: "review_reminder", email: "ada@example.com", first_name: "Ada", last_name: "Lovelace", status: "queued" },
      { template_key: "review_reminder", email: "grace@example.com", first_name: "Grace", last_name: "Hopper", status: "queued" },
    ]);
    const links = await pglite.query<{ user_id: string; email: string; source: string }>(
      `SELECT identity.user_id, contact.email, identity.source
       FROM user_contact_links identity
       JOIN contacts contact ON contact.id=identity.contact_id AND contact.event_id=identity.event_id
       WHERE identity.event_id=$1 AND identity.user_id IN ($2,$3)
       ORDER BY contact.email`,
      [eventId, ada, grace],
    );
    expect(links.rows).toEqual([
      { user_id: ada, email: "ada@example.com", source: "reminder" },
      { user_id: grace, email: "grace@example.com", source: "reminder" },
    ]);

    // Replaying the same organizer-confirmed attempt is idempotent; the window
    // still governs whether any attempt is allowed.
    await sendReviewRemindersIn(db, eventId, planId, null, REMINDER_ATTEMPT_A, AT_OPEN.getTime());
    const again = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM communication_logs WHERE event_id=$1", [eventId]);
    expect(again.rows[0]?.n).toBe(2);

    const closed = await sendReviewRemindersIn(db, eventId, planId, null, REMINDER_ATTEMPT_A, AFTER_CLOSE.getTime())
      .catch((thrown: unknown) => thrown);
    expect(isAppError(closed) && closed.code).toBe("CONFLICT");
    const early = await sendReviewRemindersIn(db, eventId, planId, null, REMINDER_ATTEMPT_A, BEFORE_OPEN.getTime())
      .catch((thrown: unknown) => thrown);
    expect(isAppError(early) && early.code).toBe("CONFLICT");

    /**
     * The row is only half the promise. A queued reminder that cannot be
     * *rendered* fails at the dispatcher with `TEMPLATE_VAR_MISSING`, on the
     * deployed preview, hours later — and this template's four variables are
     * recovered from the idempotency key rather than from a foreign key, which
     * is exactly the kind of wiring that no enqueue assertion touches.
     */
    const [queued] = await db.select().from(communicationLogs)
      .where(eq(communicationLogs.idempotencyKey, idem.reviewReminder(eventId, planId, ada, REMINDER_ATTEMPT_A)));
    expect(queued, "the reminder enqueued above is what gets rendered").toBeDefined();
    const context = await buildContext(queued as OutboxRow, db, mailEnv);
    const template = DEFAULT_TEMPLATES.review_reminder;
    const rendered = renderTemplateContent("review_reminder", template.subject, template.bodyHtml, context.vars, {});
    expect(rendered.html).toContain(`/events/${eventId}/review?planId=${planId}`);
    expect(rendered.html).toContain("Round 1");
    expect(rendered.subject.length).toBeGreaterThan(0);
    // Two of Ada's three assigned abstracts are still unscored, the round she is
    // being reminded about is named rather than guessed at, and the deadline is
    // a real date rather than the "when the organizers close it" fallback.
    const review = (context.vars as { review: { round: string; outstanding: string; closes_at: string } }).review;
    expect(review).toMatchObject({ round: "Round 1", outstanding: "2" });
    expect(review.closes_at).toContain("2026");

    // Linking an admin reviewer never bypasses the event contact's consent.
    await pglite.query("UPDATE contacts SET unsubscribed_at=now() WHERE id=$1 AND event_id=$2", [adaContact, eventId]);
    await expect(buildContext(queued as OutboxRow, db, mailEnv)).rejects.toThrow(/contact unsubscribed/u);
    await pglite.query("UPDATE contacts SET unsubscribed_at=NULL WHERE id=$1 AND event_id=$2", [adaContact, eventId]);

    // And the precondition that keeps a nagging email off a finished queue:
    // once nothing is outstanding the row is skipped at render time, not sent
    // with a zero in it.
    await submitReviewIn(db, eventId, planId, two, ada, verdict({ overallScore: 4 }), AT_OPEN);
    await submitReviewIn(db, eventId, planId, three, ada, verdict({ overallScore: 4 }), AT_OPEN);
    await expect(buildContext(queued as OutboxRow, db, mailEnv)).rejects.toThrow(/nothing outstanding/u);
  });

  it("quarantines an ambiguous reviewer identity instead of enqueueing to another user's contact", async () => {
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'ambiguous.reviewer@example.com','Ambiguous Reviewer')",
      [ambiguousReviewer],
    );
    await pglite.query(
      "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'reviewer')",
      [ambiguousReviewer, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ambiguous.reviewer@example.com','Wrong','Owner')",
      [ambiguousReviewerContact, eventId],
    );
    await pglite.query(
      "INSERT INTO user_contact_links(user_id,event_id,contact_id,source) VALUES($1,$2,$3,'operator')",
      [organizer, eventId, ambiguousReviewerContact],
    );
    const planId = await seedPlan({ opensAt: AT_OPEN.toISOString(), closesAt: AT_CLOSE.toISOString() });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ambiguousReviewer, trackIds: null }]);

    await expect(sendReviewRemindersIn(
      db,
      eventId,
      planId,
      [ambiguousReviewer],
      REMINDER_ATTEMPT_A,
      AT_OPEN.getTime(),
    )).resolves.toEqual({ enqueued: 0, skipped: 1 });
    expect((await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM communication_logs WHERE event_id=$1 AND idempotency_key=$2",
      [eventId, idem.reviewReminder(eventId, planId, ambiguousReviewer, REMINDER_ATTEMPT_A)],
    )).rows).toEqual([{ count: 0 }]);
  });

  it("deduplicates a manual reminder attempt across minute boundaries while allowing a new attempt", async () => {
    const planId = await seedPlan({
      opensAt: AT_OPEN.toISOString(),
      closesAt: AT_CLOSE.toISOString(),
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);

    await sendReviewRemindersIn(db, eventId, planId, [ada], REMINDER_ATTEMPT_A, AT_OPEN.getTime());
    await sendReviewRemindersIn(db, eventId, planId, [ada], REMINDER_ATTEMPT_A, AT_OPEN.getTime() + 61_000);

    const afterRetry = await pglite.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM communication_logs WHERE event_id=$1 ORDER BY idempotency_key",
      [eventId],
    );
    expect(afterRetry.rows.map((row) => row.idempotency_key)).toEqual([
      idem.reviewReminder(eventId, planId, ada, REMINDER_ATTEMPT_A),
    ]);

    await sendReviewRemindersIn(db, eventId, planId, [ada], REMINDER_ATTEMPT_B, AT_OPEN.getTime() + 62_000);
    const afterNewAttempt = await pglite.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM communication_logs WHERE event_id=$1 ORDER BY idempotency_key",
      [eventId],
    );
    expect(afterNewAttempt.rows.map((row) => row.idempotency_key)).toEqual([
      idem.reviewReminder(eventId, planId, ada, REMINDER_ATTEMPT_A),
      idem.reviewReminder(eventId, planId, ada, REMINDER_ATTEMPT_B),
    ]);
  });

  it("sends only to the reviewer IDs approved by the preview when the round expands", async () => {
    const planId = await seedPlan({
      opensAt: AT_OPEN.toISOString(),
      closesAt: AT_CLOSE.toISOString(),
    });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const preview = await listOutstandingReviewersIn(db, eventId, planId);
    expect(preview.map((target) => target.reviewerUserId)).toEqual([ada]);

    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [
      { userId: ada, trackIds: null },
      { userId: grace, trackIds: null },
    ]);
    expect((await listOutstandingReviewersIn(db, eventId, planId)).map((target) => target.reviewerUserId).sort())
      .toEqual([ada, grace].sort());

    await sendReviewRemindersIn(
      db,
      eventId,
      planId,
      preview.map((target) => target.reviewerUserId),
      REMINDER_ATTEMPT_A,
      AT_OPEN.getTime(),
    );
    const recipients = await pglite.query<{ email: string }>(
      `SELECT c.email FROM communication_logs l
       JOIN contacts c ON c.id = l.contact_id
       WHERE l.event_id=$1 AND l.template_key='review_reminder'
       ORDER BY c.email`,
      [eventId],
    );
    expect(recipients.rows.map((row) => row.email)).toEqual(["ada@example.com"]);
  });

});

function verdict(
  overrides: Partial<{ overallScore: number | null; criterionScores: Record<string, unknown>; comment: string | null }> = {},
) {
  return { overallScore: null, criterionScores: {}, comment: null, ...overrides } as Parameters<typeof submitReviewIn>[5];
}
