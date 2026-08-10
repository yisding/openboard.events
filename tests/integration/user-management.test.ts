import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { communicationLogs, organizationInvitations } from "@/db/schema";
import { listAdminSessionsIn, revokeAdminSessionByIdIn } from "@/features/auth/server/sessions";
import { buildContext, isOrganizationInviteTemplate } from "@/features/comms/server/context";
import { renderTemplateContent } from "@/features/comms/server/render";
import { DEFAULT_TEMPLATES } from "@/features/comms/server/templates";
import {
  acceptOrganizationInvitationByTokenIn,
  changeOrganizationMemberRoleIn,
  createOrganizationIn,
  findPendingInvitationByEmailIn,
  getOrganizationMemberRoleIn,
  inviteOrganizationMemberInputSchema,
  inviteOrganizationMemberIn,
  issueOrganizationInvitationTokenIn,
  listOrganizationAuditLogIn,
  listPendingOrganizationInvitationsIn,
  provisionOrganizationForNewUserIn,
  removeOrganizationMemberAuditedIn,
  revokeOrganizationInvitationIn,
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
  ADMIN_AUTH_PROVIDER: "better-auth",
});

describe("M44 user management", () => {
  let pglite: PGlite;
  let db: DbOrTx;

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
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
  }, 60_000);

  afterAll(async () => pglite.close());

  describe("invitations", () => {
    it("invites a teammate, routes the mail through the org's home event, and re-inviting refreshes the same row", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Invite Co", slug: "invite-co" });
      await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [org.id, eventId]);
      try {
        const first = await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "New.Person@Example.com", role: "reviewer" });
        expect(first.emailQueued).toBe(true);
        expect(first.invitation.email).toBe("new.person@example.com");
        expect(first.invitation.role).toBe("reviewer");

        const pending = await listPendingOrganizationInvitationsIn(db, org.id);
        expect(pending).toHaveLength(1);

        // Re-inviting the same address at a different role refreshes the same
        // row (same id) rather than erroring or duplicating.
        const second = await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "new.person@example.com", role: "organizer" });
        expect(second.invitation.id).toBe(first.invitation.id);
        expect(second.invitation.role).toBe("organizer");
        expect((await listPendingOrganizationInvitationsIn(db, org.id))).toHaveLength(1);

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.filter((entry) => entry.action === "member.invited")).toHaveLength(2);
      } finally {
        await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001"), eventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("refuses to invite anyone as owner — ownership is transferred, not invited", () => {
      // The zod schema itself excludes "owner": the API surface, not just a
      // runtime check inside the mutation, refuses it.
      expect(inviteOrganizationMemberInputSchema.safeParse({ email: "x@example.com", role: "owner" }).success).toBe(false);
    });

    it("queues nothing (but still creates the invitation) when the organization has no event to route mail through", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "No Events Yet", slug: "no-events-yet" });
      try {
        const result = await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "stranded@example.com", role: "reviewer" });
        expect(result.emailQueued).toBe(false);
        expect(result.invitation.email).toBe("stranded@example.com");
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("revokes a pending invitation, and refuses to revoke one twice", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Revoke Co", slug: "revoke-co" });
      try {
        const { invitation } = await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "gone@example.com", role: "reviewer" });
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
      await pglite.query(
        "INSERT INTO users(id,email,name) VALUES($1,'invitee@example.com','Invitee')",
        [userIdSchema.parse("e4400000-0000-4000-8000-000000000099")],
      );
      const inviteeId = userIdSchema.parse("e4400000-0000-4000-8000-000000000099");
      try {
        const { invitation } = await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "invitee@example.com", role: "reviewer" });
        const issued = await issueOrganizationInvitationTokenIn(db, invitation.id);
        if (!issued) throw new Error("expected a mintable token");

        // Wrong email: FORBIDDEN, and the invitation is still pending.
        await expect(acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: ownerId, email: "owner@example.com" }))
          .rejects.toMatchObject({ code: "FORBIDDEN" });

        const accepted = await acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: inviteeId, email: "invitee@example.com" });
        expect(accepted).toMatchObject({ organizationId: org.id, role: "reviewer" });
        await expect(getOrganizationMemberRoleIn(db, org.id, inviteeId)).resolves.toBe("reviewer");

        // A second accept of the same token fails — it is no longer pending.
        await expect(acceptOrganizationInvitationByTokenIn(db, issued.raw, { userId: inviteeId, email: "invitee@example.com" }))
          .rejects.toMatchObject({ code: "VALIDATION" });

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.some((entry) => entry.action === "invitation.accepted" && entry.targetUserId === inviteeId)).toBe(true);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });
  });

  describe("role management", () => {
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
      await setOrganizationMemberIn(db, org.id, organizerId, "organizer");
      await setOrganizationMemberIn(db, org.id, reviewerId, "reviewer");
      try {
        await removeOrganizationMemberAuditedIn(db, org.id, organizerId, "organizer", reviewerId);
        await expect(getOrganizationMemberRoleIn(db, org.id, reviewerId)).resolves.toBeNull();

        await expect(removeOrganizationMemberAuditedIn(db, org.id, organizerId, "organizer", ownerId)).rejects.toMatchObject({ code: "FORBIDDEN" });

        const audits = await listOrganizationAuditLogIn(db, org.id);
        expect(audits.some((entry) => entry.action === "member.removed" && entry.targetUserId === reviewerId)).toBe(true);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });
  });

  describe("self-serve signup provisioning", () => {
    it("creates a new organization for a signup with no matching invitation, and makes them its owner", async () => {
      const newUserId = userIdSchema.parse("e4400000-0000-4000-8000-000000000201");
      await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'fresh@example.com','Fresh Person')", [newUserId]);
      const result = await provisionOrganizationForNewUserIn(db, newUserId, "fresh@example.com", "Fresh Person");
      expect(result.viaInvitation).toBe(false);
      await expect(getOrganizationMemberRoleIn(db, result.organizationId, newUserId)).resolves.toBe("owner");
    });

    it("folds a signup into a matching pending invitation instead of creating a second organization", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Fold Co", slug: "fold-co" });
      const invitedUserId = userIdSchema.parse("e4400000-0000-4000-8000-000000000202");
      try {
        await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "invited-signup@example.com", role: "organizer" });
        expect(await findPendingInvitationByEmailIn(db, "invited-signup@example.com")).not.toBeNull();

        await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'invited-signup@example.com','Invited Signup')", [invitedUserId]);
        const result = await provisionOrganizationForNewUserIn(db, invitedUserId, "invited-signup@example.com", "Invited Signup");
        expect(result.viaInvitation).toBe(true);
        expect(result.organizationId).toBe(org.id);
        await expect(getOrganizationMemberRoleIn(db, org.id, invitedUserId)).resolves.toBe("organizer");
        // The invitation is consumed — a second signup attempt for the same
        // address (impossible in practice; `users.email` is unique) would not
        // find it pending anymore.
        expect(await findPendingInvitationByEmailIn(db, "invited-signup@example.com")).toBeNull();
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });
  });

  describe("team-invitation mail", () => {
    it("mints the join token at render time and renders the invite mail with no speaker-portal link", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Mail Co", slug: "mail-co" });
      await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [org.id, eventId]);
      try {
        const { invitation } = await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "mailed@example.com", role: "reviewer" });
        expect(isOrganizationInviteTemplate("organization_invited")).toBe(true);

        const [row] = await db.select().from(communicationLogs)
          .where(and(eq(communicationLogs.templateKey, "organization_invited"), eq(communicationLogs.eventId, eventId)))
          .orderBy(desc(communicationLogs.createdAt)).limit(1);
        if (!row) throw new Error("expected a queued organization_invited row");
        expect(row.secretPayloadCiphertext).toBeNull();

        const context = await buildContext(row, db, env);
        const template = DEFAULT_TEMPLATES.organization_invited;
        const rendered = renderTemplateContent("organization_invited", template.subject, template.bodyHtml, context.vars, {});
        expect(rendered.subject).toContain("Mail Co");
        expect(rendered.html).toContain("/join?token=");
        expect(rendered.html).not.toContain("/portal/");
        expect(rendered.html).toContain("owner@example.com");

        // Rendering rotated the token — the row's original placeholder hash no
        // longer matches anything, but the invitation itself is still pending.
        const [afterRender] = await db.select({ tokenHash: organizationInvitations.tokenHash }).from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
        expect(afterRender?.tokenHash).toBeTruthy();
      } finally {
        await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001"), eventId]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("skips rendering once the invitation has already been revoked", async () => {
      const org = await createOrganizationIn(db, ownerId, { name: "Skip Co", slug: "skip-co" });
      await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [org.id, eventId]);
      try {
        const { invitation } = await inviteOrganizationMemberIn(db, org.id, ownerId, { email: "revoked-before-send@example.com", role: "reviewer" });
        await revokeOrganizationInvitationIn(db, org.id, invitation.id, ownerId);

        const [row] = await db.select().from(communicationLogs)
          .where(and(eq(communicationLogs.templateKey, "organization_invited"), eq(communicationLogs.eventId, eventId)))
          .orderBy(desc(communicationLogs.createdAt)).limit(1);
        if (!row) throw new Error("expected a queued organization_invited row");
        await expect(buildContext(row, db, env)).rejects.toThrowError(/no longer pending/u);
      } finally {
        await pglite.query("UPDATE events SET organization_id=$1 WHERE id=$2", [organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001"), eventId]);
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

      // Cannot revoke another user's session by id.
      await expect(revokeAdminSessionByIdIn(db, ownerId, "e4400000-0000-4000-8000-000000000303")).rejects.toMatchObject({ code: "NOT_FOUND" });

      await revokeAdminSessionByIdIn(db, ownerId, "e4400000-0000-4000-8000-000000000301");
      expect((await listAdminSessionsIn(db, ownerId)).map((s) => s.id)).toEqual(["e4400000-0000-4000-8000-000000000302"]);
    });
  });
});
