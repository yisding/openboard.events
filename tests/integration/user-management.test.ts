import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { adminAuthEmailOutbox, communicationLogs, organizationInvitations } from "@/db/schema";
import { dispatchAdminAuthEmailOutboxIn, openPlatformAdminLinkPayload } from "@/features/auth";
import { listAdminSessionsIn, revokeAdminSessionByIdIn } from "@/features/auth/server/sessions";
import { resolveUserContactIn } from "@/features/event-contacts";
import {
  acceptOrganizationInvitationByTokenIn,
  assertOrganizationInvitationTokenForEmailIn,
  changeOrganizationMemberRoleIn,
  createOrganizationIn,
  getOrganizationMemberRoleIn,
  getOrganizationInvitationDestinationByTokenIn,
  inviteEventReviewerIn,
  inviteOrganizationMemberInputSchema,
  inviteOrganizationMemberIn,
  issueOrganizationInvitationTokenIn,
  listPendingEventReviewerInvitationsIn,
  listOrganizationAuditLogIn,
  listPendingOrganizationInvitationsIn,
  provisionOrganizationForNewUserIn,
  removeOrganizationMemberAuditedIn,
  revokeOrganizationInvitationIn,
  revokeEventReviewerInvitationIn,
  setOrganizationMemberIn,
} from "@/features/organizations";
import { parseEnv } from "@/shared/lib/env";
import { eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";

/**
 * M44 — user management. Self-serve signup's org provisioning, team
 * invitations through the outbox, role management's actor-side gate on top
 * of M43's last-owner guard, and the audit trail all built on it.
 */

const MIGRATIONS = [
  "0000_init", "0001_views_triggers", "0002_admin_auth", "0003_jade_defaults",
  "0004_review_operations", "0005_rate_limits", "0006_content_deliverables",
  "0007_email_compliance", "0008_speaker_roster_operations", "0009_product_auth",
  "0010_organization_tenancy", "0011_user_management", "0012_billing_scaffold",
  // M44 is the subject here, so this list stops at 0012 rather than tracking
  // the journal — with one exception. 0016 adds `contacts.acceptance_seen_at`,
  // which `getOrCreateContact`'s unqualified `.returning()` names on the
  // invitation path below, so the column has to exist even though nothing here
  // reads it. 0013 and 0041 are the other exception: reviewer invitation
  // acceptance now writes the stable event-contact link, and 0041's additive
  // schema depends on the CRM link table. 0014's template backfill remains
  // skipped because it would change the rows the outbox assertions inspect.
  "0013_speaker_crm",
  "0016_speaker_moments",
  "0022_admin_auth_email_outbox", "0025_platform_invitation_email",
  "0029_event_reviewer_invitations", "0041_stable_user_contact_links",
];

const eventId = eventIdSchema.parse("e4400000-0000-4000-8000-000000000001");
const ownerId = userIdSchema.parse("e4400000-0000-4000-8000-000000000011");
const organizerId = userIdSchema.parse("e4400000-0000-4000-8000-000000000012");
const reviewerId = userIdSchema.parse("e4400000-0000-4000-8000-000000000013");

const env = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-bytes",
  UNSUBSCRIBE_SECRET: "test-unsubscribe-secret-at-least-32-bytes-long",
  EMAIL_MODE: "log",
  EMAIL_FALLBACK_UI: "1",
});

describe("M44 user management", () => {
  let pglite: PGlite;
  let db: DbOrTx;
  let testDb: ReturnType<typeof drizzle>;

  const inviteForTest = (
    organizationId: Parameters<typeof inviteOrganizationMemberIn>[1],
    userId: Parameters<typeof inviteOrganizationMemberIn>[2],
    input: Parameters<typeof inviteOrganizationMemberIn>[3],
    runtimeEnv = env,
  ) => testDb.transaction((tx) => inviteOrganizationMemberIn(tx as unknown as TxDb, organizationId, userId, input, runtimeEnv));

  beforeAll(async () => {
    pglite = new PGlite();
    for (const name of MIGRATIONS) {
      await pglite.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8"));
    }
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Acme Conf','m44-conf','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'owner@example.com','Ada Owner'),($2,'organizer@example.com','Oscar Organizer'),($3,'reviewer@example.com','Rae Reviewer')",
      [ownerId, organizerId, reviewerId],
    );
    testDb = drizzle(pglite, { schema });
    db = testDb as unknown as DbOrTx;
  }, 60_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM admin_auth_email_outbox");
    await pglite.query("DELETE FROM communication_logs WHERE template_key='organization_invited'");
  });

  afterAll(async () => pglite.close());

  describe("invitations", () => {
    it("lets a reviewer accept secure event access without an organizer-created password", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Reviewer Invite Co", slug: "reviewer-invite-co" });
      const reviewEventId = eventIdSchema.parse("e4400000-0000-4000-8000-000000000090");
      const inviteeId = userIdSchema.parse("e4400000-0000-4000-8000-000000000091");
      await pglite.query(
        "INSERT INTO events(id,organization_id,name,slug,starts_at,ends_at) VALUES($1,$2,'Review Invitation Conf','review-invitation-conf','2026-10-15T16:00:00Z','2026-10-17T01:00:00Z')",
        [reviewEventId, org.id],
      );
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'owner')", [ownerId, reviewEventId]);
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'reviewer')", [reviewerId, reviewEventId]);
      try {
        const queued = await testDb.transaction((tx) => inviteEventReviewerIn(
          tx as unknown as TxDb,
          reviewEventId,
          ownerId,
          { email: "new.event.reviewer@example.com" },
          env,
        ));
        expect(queued).toEqual({
          email: "new.event.reviewer@example.com",
          emailQueued: true,
          eventName: "Review Invitation Conf",
        });

        // Inviting is not account provisioning: no user or membership exists
        // until the address owner accepts the emailed bearer credential.
        const beforeAccept = await pglite.query<{ users: number; access: number }>(`
          SELECT
            (SELECT count(*)::int FROM users WHERE email='new.event.reviewer@example.com') AS users,
            (SELECT count(*)::int FROM event_members member JOIN users ON users.id=member.user_id WHERE member.event_id=$1 AND users.email='new.event.reviewer@example.com') AS access
        `, [reviewEventId]);
        expect(beforeAccept.rows[0]).toEqual({ users: 0, access: 0 });
        expect(await listPendingOrganizationInvitationsIn(db, org.id)).toEqual([]);

        const [mail] = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "new.event.reviewer@example.com"));
        if (!mail?.secretPayloadCiphertext) throw new Error("expected an encrypted reviewer invitation");
        const payload = await openPlatformAdminLinkPayload(
          mail.secretPayloadCiphertext,
          { userId: ownerId, messageId: mail.id },
          env.SESSION_SECRET,
        );
        expect(payload).toMatchObject({
          organizationName: "Reviewer Invite Co",
          eventName: "Review Invitation Conf",
          invitationRole: "reviewer",
        });
        const rawToken = new URL(payload.url).searchParams.get("token");
        if (!rawToken) throw new Error("expected a reviewer invitation token");
        await expect(getOrganizationInvitationDestinationByTokenIn(db, rawToken))
          .resolves.toBe(`/events/${reviewEventId}/review`);

        await expect(dispatchAdminAuthEmailOutboxIn(db, 10, { env })).resolves.toMatchObject({ sent: 1 });
        const [sent] = await db.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, mail.id));
        expect(sent).toMatchObject({ status: "sent", subjectRendered: "You're invited to review Review Invitation Conf" });
        expect(sent?.bodyRenderedHtml).toContain("create your own account");
        expect(sent?.bodyRenderedHtml).not.toContain("password");

        await pglite.query(
          "INSERT INTO users(id,email,name) VALUES($1,'new.event.reviewer@example.com','New Reviewer')",
          [inviteeId],
        );
        const accepted = await provisionOrganizationForNewUserIn(
          db,
          inviteeId,
          "new.event.reviewer@example.com",
          "New Reviewer",
          { invitationToken: rawToken },
        );
        expect(accepted).toEqual({
          organizationId: org.id,
          viaInvitation: true,
          eventId: reviewEventId,
        });
        await expect(getOrganizationMemberRoleIn(db, org.id, inviteeId)).resolves.toBe("reviewer");
        const membership = await pglite.query<{ role: string }>(
          "SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2",
          [reviewEventId, inviteeId],
        );
        expect(membership.rows).toEqual([{ role: "reviewer" }]);
        const contact = await pglite.query<{ email: string; first_name: string; last_name: string }>(
          "SELECT email,first_name,last_name FROM contacts WHERE event_id=$1 AND email='new.event.reviewer@example.com'",
          [reviewEventId],
        );
        expect(contact.rows).toEqual([{ email: "new.event.reviewer@example.com", first_name: "New", last_name: "Reviewer" }]);
        const link = await pglite.query<{ source: string; email: string }>(
          `SELECT identity.source, contact.email
           FROM user_contact_links identity
           JOIN contacts contact ON contact.id=identity.contact_id AND contact.event_id=identity.event_id
           WHERE identity.event_id=$1 AND identity.user_id=$2`,
          [reviewEventId, inviteeId],
        );
        expect(link.rows).toEqual([{ source: "invitation", email: "new.event.reviewer@example.com" }]);
      } finally {
        await pglite.query("DELETE FROM events WHERE id=$1", [reviewEventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
        await pglite.query("DELETE FROM users WHERE id=$1", [inviteeId]);
      }
    });

    it("preserves stronger workspace roles and refuses invitations for existing event access", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Role-safe Review Co", slug: "role-safe-review-co" });
      const reviewEventId = eventIdSchema.parse("e4400000-0000-4000-8000-000000000092");
      await pglite.query(
        "INSERT INTO events(id,organization_id,name,slug,starts_at,ends_at) VALUES($1,$2,'Role-safe Review Conf','role-safe-review-conf','2026-10-15T16:00:00Z','2026-10-17T01:00:00Z')",
        [reviewEventId, org.id],
      );
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'owner')", [ownerId, reviewEventId]);
      await setOrganizationMemberIn(db, org.id, organizerId, "organizer");
      try {
        const occupiedContactId = "e4400000-0000-4000-8000-000000000094";
        await pglite.query(
          "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'organizer@example.com','Occupied','Identity')",
          [occupiedContactId, reviewEventId],
        );
        await pglite.query(
          "INSERT INTO user_contact_links(user_id,event_id,contact_id,source) VALUES($1,$2,$3,'operator')",
          [ownerId, reviewEventId, occupiedContactId],
        );
        await testDb.transaction((tx) => inviteEventReviewerIn(
          tx as unknown as TxDb,
          reviewEventId,
          ownerId,
          { email: "organizer@example.com" },
          env,
        ));
        const [mail] = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "organizer@example.com"));
        if (!mail?.secretPayloadCiphertext) throw new Error("expected an encrypted reviewer invitation");
        const payload = await openPlatformAdminLinkPayload(
          mail.secretPayloadCiphertext,
          { userId: ownerId, messageId: mail.id },
          env.SESSION_SECRET,
        );
        const rawToken = new URL(payload.url).searchParams.get("token");
        if (!rawToken) throw new Error("expected a reviewer invitation token");
        await acceptOrganizationInvitationByTokenIn(db, rawToken, { userId: organizerId, email: "organizer@example.com" });
        await expect(getOrganizationMemberRoleIn(db, org.id, organizerId)).resolves.toBe("organizer");
        await expect(resolveUserContactIn(db, reviewEventId, organizerId)).resolves.toEqual({
          status: "ambiguous",
          candidateContactIds: [occupiedContactId],
        });

        await expect(testDb.transaction((tx) => inviteEventReviewerIn(
          tx as unknown as TxDb,
          reviewEventId,
          ownerId,
          { email: "organizer@example.com" },
          env,
        ))).rejects.toMatchObject({ code: "CONFLICT" });
      } finally {
        await pglite.query("DELETE FROM events WHERE id=$1", [reviewEventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("lets only an event organizer revoke a pending reviewer link", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Revocable Review Co", slug: "revocable-review-co" });
      const reviewEventId = eventIdSchema.parse("e4400000-0000-4000-8000-000000000093");
      await pglite.query(
        "INSERT INTO events(id,organization_id,name,slug,starts_at,ends_at) VALUES($1,$2,'Revocable Review Conf','revocable-review-conf','2026-10-15T16:00:00Z','2026-10-17T01:00:00Z')",
        [reviewEventId, org.id],
      );
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'owner')", [ownerId, reviewEventId]);
      try {
        await testDb.transaction((tx) => inviteEventReviewerIn(
          tx as unknown as TxDb,
          reviewEventId,
          ownerId,
          { email: "mistyped@example.com" },
          env,
        ));
        const [pending] = await listPendingEventReviewerInvitationsIn(db, reviewEventId);
        if (!pending) throw new Error("expected a pending reviewer invitation");

        await expect(revokeEventReviewerInvitationIn(db, reviewEventId, pending.id, reviewerId))
          .rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(revokeOrganizationInvitationIn(db, org.id, pending.id, ownerId))
          .rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(listPendingEventReviewerInvitationsIn(db, reviewEventId)).resolves.toHaveLength(1);

        await revokeEventReviewerInvitationIn(db, reviewEventId, pending.id, ownerId);
        await expect(listPendingEventReviewerInvitationsIn(db, reviewEventId)).resolves.toEqual([]);
        await expect(dispatchAdminAuthEmailOutboxIn(db, 10, { env })).resolves.toMatchObject({ skipped: 1, sent: 0 });
      } finally {
        await pglite.query("DELETE FROM events WHERE id=$1", [reviewEventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("queues product-scoped mail and re-inviting refreshes the same invitation without a stale send", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Invite Co", slug: "invite-co" });
      await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [org.id, eventId]);
      try {
        const first = await inviteForTest(org.id, ownerId, { email: "New.Person@Example.com", role: "reviewer" });
        expect(first.emailQueued).toBe(true);
        expect(first.invitation.email).toBe("new.person@example.com");
        expect(first.invitation.role).toBe("reviewer");

        const pending = await listPendingOrganizationInvitationsIn(db, org.id);
        expect(pending).toHaveLength(1);

        // Re-inviting the same address at a different role refreshes the same
        // row (same id) rather than erroring or duplicating.
        const second = await inviteForTest(org.id, ownerId, { email: "new.person@example.com", role: "organizer" });
        expect(second.invitation.id).toBe(first.invitation.id);
        expect(second.invitation.role).toBe("organizer");
        expect((await listPendingOrganizationInvitationsIn(db, org.id))).toHaveLength(1);

        const platformRows = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "new.person@example.com"));
        expect(platformRows).toHaveLength(2);
        expect(platformRows.map((row) => row.status).sort()).toEqual(["queued", "skipped"]);
        expect(platformRows.find((row) => row.status === "skipped")?.secretPayloadCiphertext).toBeNull();
        expect((await db.select().from(communicationLogs)
          .where(eq(communicationLogs.templateKey, "organization_invited")))).toHaveLength(0);

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.filter((entry) => entry.action === "member.invited")).toHaveLength(2);
      } finally {
        await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001"), eventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("rolls a resend back while the prior message is being delivered", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Claimed Invite Co", slug: "claimed-invite-co" });
      try {
        const first = await inviteForTest(org.id, ownerId, { email: "claimed@example.com", role: "reviewer" });
        const [before] = await db.select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations).where(eq(organizationInvitations.id, first.invitation.id));
        await pglite.query(
          "UPDATE admin_auth_email_outbox SET locked_until=now()+interval '3 minutes' WHERE recipient_email=$1",
          ["claimed@example.com"],
        );

        await expect(inviteForTest(org.id, ownerId, { email: "claimed@example.com", role: "organizer" }))
          .rejects.toMatchObject({ code: "CONFLICT" });

        const [invitation] = await db.select({ role: organizationInvitations.role, tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations).where(eq(organizationInvitations.id, first.invitation.id));
        expect(invitation).toEqual({ role: "reviewer", tokenHash: before?.tokenHash });
        const messages = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "claimed@example.com"));
        expect(messages).toHaveLength(1);
        expect(messages[0]?.status).toBe("queued");
        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.filter((entry) => entry.action === "member.invited")).toHaveLength(1);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("refuses to invite anyone as owner — ownership is transferred, not invited", () => {
      // The zod schema itself excludes "owner": the API surface, not just a
      // runtime check inside the mutation, refuses it.
      expect(inviteOrganizationMemberInputSchema.safeParse({ email: "x@example.com", role: "owner" }).success).toBe(false);
    });

    it("queues a deliverable invitation before the organization has any event", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "No Events Yet", slug: "no-events-yet" });
      try {
        const result = await inviteForTest(org.id, ownerId, { email: "stranded@example.com", role: "reviewer" });
        expect(result.emailQueued).toBe(true);
        expect(result.invitation.email).toBe("stranded@example.com");
        const [queued] = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "stranded@example.com"));
        expect(queued).toMatchObject({ templateKey: "organization_invited", status: "queued", userId: ownerId });
        expect(queued?.secretPayloadCiphertext).not.toBeNull();
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("revokes a pending invitation, and refuses to revoke one twice", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Revoke Co", slug: "revoke-co" });
      try {
        const { invitation } = await inviteForTest(org.id, ownerId, { email: "gone@example.com", role: "reviewer" });
        await revokeOrganizationInvitationIn(db, org.id, invitation.id, ownerId);
        await expect(revokeOrganizationInvitationIn(db, org.id, invitation.id, ownerId)).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await listPendingOrganizationInvitationsIn(db, org.id)).toEqual([]);
        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.some((entry) => entry.action === "invitation.revoked")).toBe(true);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("accepts a token only for the identity whose email it was sent to, and only once", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Accept Co", slug: "accept-co" });
      const invitedEventId = eventIdSchema.parse("e4400000-0000-4000-8000-000000000098");
      await pglite.query(
        "INSERT INTO events(id,organization_id,name,slug,starts_at,ends_at) VALUES($1,$2,'Invitation Scope Conf','invitation-scope-conf','2026-10-15T16:00:00Z','2026-10-17T01:00:00Z')",
        [invitedEventId, org.id],
      );
      await pglite.query(
        "INSERT INTO users(id,email,name) VALUES($1,'invitee@example.com','Invitee')",
        [userIdSchema.parse("e4400000-0000-4000-8000-000000000099")],
      );
      const inviteeId = userIdSchema.parse("e4400000-0000-4000-8000-000000000099");
      try {
        const { invitation } = await inviteForTest(org.id, ownerId, { email: "invitee@example.com", role: "reviewer" });
        const issued = await issueOrganizationInvitationTokenIn(db, invitation.id);
        if (!issued) throw new Error("expected a mintable token");

        // Wrong email: FORBIDDEN, and the invitation is still pending.
        await expect(acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: ownerId, email: "owner@example.com" }))
          .rejects.toMatchObject({ code: "FORBIDDEN" });

        const accepted = await acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: inviteeId, email: "invitee@example.com" });
        expect(accepted).toMatchObject({ organizationId: org.id, role: "reviewer" });
        await expect(getOrganizationMemberRoleIn(db, org.id, inviteeId)).resolves.toBe("reviewer");
        const eventMemberships = await pglite.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM event_members WHERE event_id=$1 AND user_id=$2",
          [invitedEventId, inviteeId],
        );
        expect(eventMemberships.rows[0]?.count).toBe(0);

        // A second accept of the same token fails — it is no longer pending.
        await expect(acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: inviteeId, email: "invitee@example.com" }))
          .rejects.toMatchObject({ code: "VALIDATION" });

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.some((entry) => entry.action === "invitation.accepted" && entry.targetUserId === inviteeId)).toBe(true);
      } finally {
        await pglite.query("DELETE FROM events WHERE id=$1", [invitedEventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("does not consume an invitation that would demote the organization's last owner", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Owner Guard Co", slug: "owner-guard-co" });
      try {
        const { invitation } = await inviteForTest(org.id, ownerId, { email: "owner@example.com", role: "reviewer" });
        const issued = await issueOrganizationInvitationTokenIn(db, invitation.id);
        if (!issued) throw new Error("expected a mintable token");

        await expect(acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: ownerId, email: "owner@example.com" }))
          .rejects.toMatchObject({ code: "VALIDATION" });
        await expect(getOrganizationMemberRoleIn(db, org.id, ownerId)).resolves.toBe("owner");

        // The failed acceptance leaves the token pending. Once another owner
        // exists, the same invitation may safely apply its requested role.
        await setOrganizationMemberIn(db, org.id, reviewerId, "owner");
        await expect(acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: ownerId, email: "owner@example.com" }))
          .resolves.toMatchObject({ organizationId: org.id, role: "reviewer" });
        await expect(getOrganizationMemberRoleIn(db, org.id, ownerId)).resolves.toBe("reviewer");
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });
  });

  describe("role management", () => {
    it("rolls role changes and removals back when their audit evidence cannot persist", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Atomic Team Co", slug: "atomic-team-co" });
      await setOrganizationMemberIn(db, org.id, organizerId, "organizer");
      await setOrganizationMemberIn(db, org.id, reviewerId, "reviewer");
      await pglite.exec(`
        CREATE FUNCTION fail_team_membership_audit() RETURNS trigger AS $$
        BEGIN
          IF NEW.action IN ('member.role_changed', 'member.removed') THEN
            RAISE EXCEPTION 'forced team membership audit failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_team_membership_audit
          BEFORE INSERT ON organization_audit_log
          FOR EACH ROW EXECUTE FUNCTION fail_team_membership_audit();
      `);
      try {
        await expect(testDb.transaction((tx) => changeOrganizationMemberRoleIn(
          tx as unknown as TxDb,
          org.id,
          ownerId,
          "owner",
          reviewerId,
          "organizer",
        ))).rejects.toThrow();
        await expect(getOrganizationMemberRoleIn(db, org.id, reviewerId)).resolves.toBe("reviewer");

        await expect(testDb.transaction((tx) => removeOrganizationMemberAuditedIn(
          tx as unknown as TxDb,
          org.id,
          ownerId,
          "owner",
          organizerId,
        ))).rejects.toThrow();
        await expect(getOrganizationMemberRoleIn(db, org.id, organizerId)).resolves.toBe("organizer");

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.filter((entry) => entry.action === "member.role_changed" || entry.action === "member.removed")).toEqual([]);
      } finally {
        await pglite.exec("DROP TRIGGER IF EXISTS fail_team_membership_audit ON organization_audit_log; DROP FUNCTION IF EXISTS fail_team_membership_audit();");
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("lets an organizer change a non-owner role, but refuses an organizer granting or revoking ownership", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Role Co", slug: "role-co" });
      await setOrganizationMemberIn(db, org.id, organizerId, "organizer");
      await setOrganizationMemberIn(db, org.id, reviewerId, "reviewer");
      try {
        // organizer promoting a reviewer to organizer: fine, no ownership involved.
        await expect(changeOrganizationMemberRoleIn(db, org.id, organizerId, "organizer", reviewerId, "organizer")).resolves.toBe("organizer");

        // organizer trying to grant ownership: forbidden, even though the
        // database-level last-owner guard would have allowed it.
        await expect(changeOrganizationMemberRoleIn(db, org.id, organizerId, "organizer", reviewerId, "owner")).rejects.toMatchObject({ code: "FORBIDDEN" });

        // an owner can grant it.
        await expect(changeOrganizationMemberRoleIn(db, org.id, ownerId, "owner", reviewerId, "owner")).resolves.toBe("owner");

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.filter((entry) => entry.action === "member.role_changed")).toHaveLength(2);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("lets an organizer remove a non-owner, but refuses to remove an owner", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Remove Co", slug: "remove-co" });
      const independentlyAssignedEventId = eventIdSchema.parse("e4400000-0000-4000-8000-000000000097");
      await pglite.query(
        "INSERT INTO events(id,organization_id,name,slug,starts_at,ends_at) VALUES($1,$2,'Independent Access Conf','independent-access-conf','2026-11-15T16:00:00Z','2026-11-17T01:00:00Z')",
        [independentlyAssignedEventId, org.id],
      );
      await setOrganizationMemberIn(db, org.id, organizerId, "organizer");
      await setOrganizationMemberIn(db, org.id, reviewerId, "reviewer");
      await pglite.query(
        "INSERT INTO event_members(event_id,user_id,role) VALUES($1,$2,'reviewer')",
        [independentlyAssignedEventId, reviewerId],
      );
      try {
        await removeOrganizationMemberAuditedIn(db, org.id, organizerId, "organizer", reviewerId);
        await expect(getOrganizationMemberRoleIn(db, org.id, reviewerId)).resolves.toBeNull();
        const eventMembership = await pglite.query<{ role: string }>(
          "SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2",
          [independentlyAssignedEventId, reviewerId],
        );
        expect(eventMembership.rows).toEqual([{ role: "reviewer" }]);

        await expect(removeOrganizationMemberAuditedIn(db, org.id, organizerId, "organizer", ownerId)).rejects.toMatchObject({ code: "FORBIDDEN" });

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.some((entry) => entry.action === "member.removed" && entry.targetUserId === reviewerId)).toBe(true);
      } finally {
        await pglite.query("DELETE FROM events WHERE id=$1", [independentlyAssignedEventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });
  });

  describe("self-serve signup provisioning", () => {
    it("creates the named organization for an ordinary signup and makes the user its owner", async () => {
      const newUserId = userIdSchema.parse("e4400000-0000-4000-8000-000000000201");
      await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'fresh@example.com','Fresh Person')", [newUserId]);
      const result = await provisionOrganizationForNewUserIn(db, newUserId, "fresh@example.com", "Fresh Person", {
        organizationName: "Fresh Events",
      });
      expect(result.viaInvitation).toBe(false);
      await expect(getOrganizationMemberRoleIn(db, result.organizationId, newUserId)).resolves.toBe("owner");
      const organization = await pglite.query<{ name: string; slug: string }>("SELECT name, slug FROM organizations WHERE id=$1", [result.organizationId]);
      expect(organization.rows[0]?.name).toBe("Fresh Events");
      expect(organization.rows[0]?.slug).toMatch(/^fresh-events-/u);
    });

    it("requires the emailed bearer token—not knowledge of the email—to join an invited organization", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Fold Co", slug: "fold-co" });
      const invitedUserId = userIdSchema.parse("e4400000-0000-4000-8000-000000000202");
      try {
        const { invitation } = await inviteForTest(org.id, ownerId, { email: "invited-signup@example.com", role: "organizer" });
        const issued = await issueOrganizationInvitationTokenIn(db, invitation.id);
        if (!issued) throw new Error("expected a live invitation token");

        await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'invited-signup@example.com','Invited Signup')", [invitedUserId]);
        const withoutToken = await provisionOrganizationForNewUserIn(db, invitedUserId, "invited-signup@example.com", "Invited Signup", {
          organizationName: "Personal Workspace",
        });
        expect(withoutToken.viaInvitation).toBe(false);
        await expect(getOrganizationMemberRoleIn(db, org.id, invitedUserId)).resolves.toBeNull();

        await expect(assertOrganizationInvitationTokenForEmailIn(db, issued.raw, "somebody-else@example.com"))
          .rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(assertOrganizationInvitationTokenForEmailIn(db, issued.raw, "invited-signup@example.com"))
          .resolves.toBeUndefined();

        const result = await provisionOrganizationForNewUserIn(db, invitedUserId, "invited-signup@example.com", "Invited Signup", {
          invitationToken: issued.raw,
        });
        expect(result.viaInvitation).toBe(true);
        expect(result.organizationId).toBe(org.id);
        await expect(getOrganizationMemberRoleIn(db, org.id, invitedUserId)).resolves.toBe("organizer");
        await expect(assertOrganizationInvitationTokenForEmailIn(db, issued.raw, "invited-signup@example.com"))
          .rejects.toMatchObject({ code: "VALIDATION" });
        await pglite.query("DELETE FROM organizations WHERE id=$1", [withoutToken.organizationId]);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });
  });

  describe("team-invitation mail", () => {
    it("encrypts one stable join token and renders eventless invitation mail with no speaker-portal link", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Mail Co", slug: "mail-co" });
      try {
        const { invitation } = await inviteForTest(org.id, ownerId, { email: "mailed@example.com", role: "reviewer" });
        const [row] = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "mailed@example.com"));
        if (!row) throw new Error("expected a queued organization_invited row");
        if (!row.secretPayloadCiphertext) throw new Error("expected an encrypted invitation link");
        const payload = await openPlatformAdminLinkPayload(
          row.secretPayloadCiphertext,
          { userId: ownerId, messageId: row.id },
          env.SESSION_SECRET,
        );
        expect(payload).toMatchObject({
          organizationName: "Mail Co",
          inviterName: "owner@example.com",
          invitationRole: "reviewer",
        });
        expect(payload.url).toContain("/join?token=");
        const [beforeDispatch] = await db.select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));

        const stats = await dispatchAdminAuthEmailOutboxIn(db, 10, { env });
        expect(stats).toMatchObject({ claimed: 1, sent: 1, skipped: 0 });
        const [sent] = await db.select().from(adminAuthEmailOutbox).where(eq(adminAuthEmailOutbox.id, row.id));
        expect(sent).toMatchObject({ status: "sent", subjectRendered: "You're invited to join Mail Co" });
        expect(sent?.bodyRenderedHtml).toContain("/join?token=");
        expect(sent?.bodyRenderedHtml).not.toContain("/portal/");
        expect(sent?.bodyRenderedHtml).toContain("owner@example.com");
        expect(sent?.secretPayloadCiphertext).toBeNull();
        const [afterDispatch] = await db.select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
        expect(afterDispatch?.tokenHash).toBe(beforeDispatch?.tokenHash);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("skips delivery once the invitation has already been revoked", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Skip Co", slug: "skip-co" });
      try {
        const { invitation } = await inviteForTest(org.id, ownerId, { email: "revoked-before-send@example.com", role: "reviewer" });
        await revokeOrganizationInvitationIn(db, org.id, invitation.id, ownerId);
        const sender = vi.fn().mockResolvedValue("must-not-send");
        const sendEnv = parseEnv({
          ...env,
          EMAIL_MODE: "send",
          EMAIL_FALLBACK_UI: "0",
          EMAIL_FROM: "Openboard <hello@example.com>",
          EMAIL_ALLOWLIST: "revoked-before-send@example.com",
          RESEND_API_KEY: "re_test",
        });
        const stats = await dispatchAdminAuthEmailOutboxIn(db, 10, { env: sendEnv, sender });
        expect(stats).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
        expect(sender).not.toHaveBeenCalled();
        const [skipped] = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "revoked-before-send@example.com"));
        expect(skipped).toMatchObject({ status: "skipped", error: "organization invitation is no longer pending" });
        expect(skipped?.secretPayloadCiphertext).toBeNull();
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("retries provider failures with the same invitation token and idempotency key", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Retry Co", slug: "retry-co" });
      try {
        const { invitation } = await inviteForTest(org.id, ownerId, { email: "retry@example.com", role: "organizer" });
        const [queued] = await db.select().from(adminAuthEmailOutbox)
          .where(eq(adminAuthEmailOutbox.recipientEmail, "retry@example.com"));
        if (!queued) throw new Error("expected a queued organization_invited row");
        const [before] = await db.select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
        const sendEnv = parseEnv({
          ...env,
          EMAIL_MODE: "send",
          EMAIL_FALLBACK_UI: "0",
          EMAIL_FROM: "Openboard <hello@example.com>",
          EMAIL_ALLOWLIST: "retry@example.com",
          RESEND_API_KEY: "re_test",
        });
        const failure = vi.fn().mockRejectedValue(new Error("provider unavailable"));
        const first = await dispatchAdminAuthEmailOutboxIn(db, 10, { env: sendEnv, sender: failure });
        expect(first).toMatchObject({ claimed: 1, retried: 1 });
        await pglite.query("UPDATE admin_auth_email_outbox SET next_attempt_at=now() WHERE id=$1", [queued.id]);

        const success = vi.fn().mockResolvedValue("retry-message-id");
        const second = await dispatchAdminAuthEmailOutboxIn(db, 10, { env: sendEnv, sender: success });
        expect(second).toMatchObject({ claimed: 1, sent: 1 });
        expect(failure.mock.calls[0]?.[0].idempotencyKey).toBe(queued.idempotencyKey);
        expect(success.mock.calls[0]?.[0].idempotencyKey).toBe(queued.idempotencyKey);
        expect(failure.mock.calls[0]?.[0].html).toBe(success.mock.calls[0]?.[0].html);
        const [after] = await db.select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
        expect(after?.tokenHash).toBe(before?.tokenHash);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });
  });

  describe("admin session views", () => {
    it("lists and revokes only the caller's own sessions", async () => {
      await pglite.query(
        "INSERT INTO admin_sessions(id,user_id,token,expires_at,ip_address,user_agent) VALUES($1,$2,'tok-a','2027-01-01T00:00:00Z','1.2.3.4','Chrome'),($3,$2,'tok-b','2027-01-01T00:00:00Z','5.6.7.8','Firefox'),($4,$5,'tok-c','2027-01-01T00:00:00Z',NULL,NULL)",
        ["e4400000-0000-4000-8000-000000000301", ownerId, "e4400000-0000-4000-8000-000000000302", "e4400000-0000-4000-8000-000000000303", organizerId],
      );
      const ownerSessions = await listAdminSessionsIn(db, ownerId);
      expect(ownerSessions.map((s) => s.id).sort()).toEqual(["e4400000-0000-4000-8000-000000000301", "e4400000-0000-4000-8000-000000000302"].sort());

      // Absence is an indistinguishable success, including for another user's
      // guessed id, but the actor-scoped predicate must leave that row intact.
      await revokeAdminSessionByIdIn(db, ownerId, "e4400000-0000-4000-8000-000000000303");
      expect((await listAdminSessionsIn(db, organizerId)).map((s) => s.id)).toEqual(["e4400000-0000-4000-8000-000000000303"]);

      // Two response-loss replays of the same target are safe and converge on
      // one logical revocation without disturbing the caller's other session.
      await Promise.all([
        revokeAdminSessionByIdIn(db, ownerId, "e4400000-0000-4000-8000-000000000301"),
        revokeAdminSessionByIdIn(db, ownerId, "e4400000-0000-4000-8000-000000000301"),
      ]);
      await revokeAdminSessionByIdIn(db, ownerId, "e4400000-0000-4000-8000-000000000301");
      expect((await listAdminSessionsIn(db, ownerId)).map((s) => s.id)).toEqual(["e4400000-0000-4000-8000-000000000302"]);
    });
  });
});
