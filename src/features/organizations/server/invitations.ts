import { and, asc, eq, like, sql } from "drizzle-orm";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import { rowsOf } from "@/db/query-result";
import { adminAuthEmailOutbox, communicationLogs, organizationInvitations, organizations } from "@/db/schema";
import {
  idem,
  organizationInvitationDtoSchema,
  type MemberRole,
  type OrganizationId,
  type OrganizationInvitationDTO,
  type OrganizationInvitationId,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { log } from "@/shared/lib/log";
import { addDuration } from "@/shared/lib/time";
import { randomBytes, sha256, toBase64Url } from "@/features/auth/server/crypto";
import { sealPlatformAdminLinkPayload } from "@/features/auth/server/secret-payload";
import type { InviteOrganizationMemberInput } from "../schemas";
import { recordOrganizationAuditEventIn } from "./audit";

/**
 * M44 — team invitations, addressed to an email and routed through the
 * product-level durable outbox. Invitations deliberately do not borrow an
 * event/contact: a brand-new workspace must be able to invite teammates before
 * its first event exists. Enqueue is transactional because rotating the bearer
 * token, retiring prior messages, storing the new encrypted message, and
 * recording the audit event are one consistency boundary. Acceptance uses one
 * data-modifying CTE for the guarded invitation claim and membership upsert, so
 * the token is consumed at most once and can never be consumed without granting
 * the membership.
 */

const INVITATION_TTL = "P14D";

function toInvitationDto(row: {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  invited_by_user_id: string;
  created_at: Date | string;
  expires_at: Date | string;
  accepted_at: Date | string | null;
  revoked_at: Date | string | null;
}): OrganizationInvitationDTO {
  return organizationInvitationDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    invitedByUserId: row.invited_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  });
}

/**
 * Invite (or re-invite) an email to an organization.
 *
 * Upserts on the same partial unique index the migration declares (one live
 * invitation per organization+email): a second "invite" click on a pending
 * invitation refreshes its role, inviter and expiry in place, and mints a new
 * outbox row rather than erroring or leaving a stale duplicate the first
 * click already queued.
 */
export async function inviteOrganizationMemberIn(
  dbOrTx: TxDb,
  organizationId: OrganizationId,
  invitedByUserId: UserId,
  input: InviteOrganizationMemberInput,
  env: RuntimeEnv = getEnv(),
): Promise<{ invitation: OrganizationInvitationDTO; emailQueued: boolean }> {
  const email = input.email.trim().toLowerCase();
  // Validate every deployment-dependent value before the transaction's first
  // mutation. Any later crypto/database failure then rolls the whole enqueue
  // boundary back instead of leaving a rotated token without a message.
  if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for organization invitation mail");
  const appBaseUrl = new URL(env.APP_BASE_URL);
  const expiresAt = addDuration(new Date(), INVITATION_TTL);
  // The placeholder is replaced by `issueOrganizationInvitationTokenIn`
  // immediately before the encrypted product-outbox row is inserted. Keeping
  // it unique still protects the brief interval between those statements.
  const placeholderTokenHash = await sha256(`placeholder:${crypto.randomUUID()}`);
  const result = await dbOrTx.execute(sql`
    INSERT INTO organization_invitations (organization_id, email, role, token_hash, invited_by_user_id, expires_at)
    VALUES (${organizationId}::uuid, ${email}, ${input.role}::member_role, ${placeholderTokenHash}, ${invitedByUserId}::uuid, ${expiresAt.toISOString()}::timestamptz)
    ON CONFLICT (organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL
    DO UPDATE SET role = EXCLUDED.role, invited_by_user_id = EXCLUDED.invited_by_user_id, expires_at = EXCLUDED.expires_at
    RETURNING id, organization_id, email, role, invited_by_user_id, created_at, expires_at, accepted_at, revoked_at
  `);
  const [row] = rowsOf<Parameters<typeof toInvitationDto>[0]>(result);
  if (!row) throw new AppError("INTERNAL", "Invitation was not created");
  const invitation = toInvitationDto(row);
  const invitationId = invitation.id;

  // A resend rotates the invitation token. Cancel every older queued copy
  // first so no worker can intentionally pick up a message whose link is now
  // stale. Delivery also revalidates the raw token immediately before send,
  // which closes the race with a row that was already claimed here.
  const invitationKey = `%:organization_invited:${invitationId}:%`;
  // Lock every prior copy before deciding whether it can be superseded. A
  // claimed row remains `queued` but has a future `locked_until`; refusing the
  // resend in that short window prevents token rotation after delivery has
  // already been authorized. If this transaction locks first, the dispatcher's
  // `FOR UPDATE SKIP LOCKED` claim cannot select the stale row.
  const priorLegacyRows = await dbOrTx.select({ lockedUntil: communicationLogs.lockedUntil })
    .from(communicationLogs)
    .where(and(
      eq(communicationLogs.templateKey, "organization_invited"),
      eq(communicationLogs.status, "queued"),
      like(communicationLogs.idempotencyKey, invitationKey),
    ))
    .for("update");
  const priorPlatformRows = await dbOrTx.select({ lockedUntil: adminAuthEmailOutbox.lockedUntil })
    .from(adminAuthEmailOutbox)
    .where(and(
      eq(adminAuthEmailOutbox.templateKey, "organization_invited"),
      eq(adminAuthEmailOutbox.status, "queued"),
      like(adminAuthEmailOutbox.idempotencyKey, invitationKey),
    ))
    .for("update");
  const now = Date.now();
  if ([...priorLegacyRows, ...priorPlatformRows].some((queued) => queued.lockedUntil && queued.lockedUntil.getTime() > now)) {
    throw new AppError("CONFLICT", "That invitation email is already being delivered — try again shortly");
  }
  await dbOrTx.update(communicationLogs).set({
    status: "skipped",
    error: "superseded by a newer organization invitation",
    lockedUntil: null,
    secretPayloadCiphertext: null,
  }).where(and(
    eq(communicationLogs.templateKey, "organization_invited"),
    eq(communicationLogs.status, "queued"),
    like(communicationLogs.idempotencyKey, invitationKey),
  ));
  await dbOrTx.update(adminAuthEmailOutbox).set({
    status: "skipped",
    error: "superseded by a newer organization invitation",
    lockedUntil: null,
    secretPayloadCiphertext: null,
  }).where(and(
    eq(adminAuthEmailOutbox.templateKey, "organization_invited"),
    eq(adminAuthEmailOutbox.status, "queued"),
    like(adminAuthEmailOutbox.idempotencyKey, invitationKey),
  ));

  const issued = await issueOrganizationInvitationTokenIn(dbOrTx, invitationId);
  if (!issued) throw new AppError("CONFLICT", "That invitation is no longer pending");
  if (issued.role === "owner") throw new AppError("INTERNAL", "Organization ownership cannot be invited");
  const messageId = crypto.randomUUID();
  const actionUrl = new URL("/join", appBaseUrl);
  actionUrl.searchParams.set("token", issued.raw);
  const secretPayloadCiphertext = await sealPlatformAdminLinkPayload({
    url: actionUrl.toString(),
    expiresIn: new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(issued.expiresAt),
    organizationName: issued.organizationName,
    inviterName: issued.inviterEmail,
    invitationRole: issued.role,
  }, { userId: invitedByUserId, messageId }, env.SESSION_SECRET);
  await dbOrTx.insert(adminAuthEmailOutbox).values({
    id: messageId,
    userId: invitedByUserId,
    recipientEmail: email,
    recipientName: "",
    templateKey: "organization_invited",
    idempotencyKey: idem.platformOrganizationInvited(invitationId, messageId),
    secretPayloadCiphertext,
  });
  const emailQueued = true;

  await recordOrganizationAuditEventIn(dbOrTx, organizationId, invitedByUserId, "member.invited", null, {
    email, role: input.role, emailQueued,
  });

  return { invitation, emailQueued };
}
export const inviteOrganizationMember = (organizationId: OrganizationId, invitedByUserId: UserId, input: InviteOrganizationMemberInput) =>
  withTx((tx) => inviteOrganizationMemberIn(tx, organizationId, invitedByUserId, input));

export async function listPendingOrganizationInvitationsIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationInvitationDTO[]> {
  const rows = await dbOrTx.select({
    id: organizationInvitations.id,
    organizationId: organizationInvitations.organizationId,
    email: organizationInvitations.email,
    role: organizationInvitations.role,
    invitedByUserId: organizationInvitations.invitedByUserId,
    createdAt: organizationInvitations.createdAt,
    expiresAt: organizationInvitations.expiresAt,
    acceptedAt: organizationInvitations.acceptedAt,
    revokedAt: organizationInvitations.revokedAt,
  }).from(organizationInvitations)
    .where(and(
      eq(organizationInvitations.organizationId, organizationId),
      sql`${organizationInvitations.acceptedAt} IS NULL`,
      sql`${organizationInvitations.revokedAt} IS NULL`,
    ))
    .orderBy(asc(organizationInvitations.createdAt));
  return rows.map((row) => organizationInvitationDtoSchema.parse({
    id: row.id, organizationId: row.organizationId, email: row.email, role: row.role,
    invitedByUserId: row.invitedByUserId, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  }));
}
export const listPendingOrganizationInvitations = (organizationId: OrganizationId) =>
  listPendingOrganizationInvitationsIn(db, organizationId);

export async function revokeOrganizationInvitationIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  invitationId: OrganizationInvitationId,
  actorUserId: UserId,
): Promise<void> {
  const result = await dbOrTx.execute(sql`
    UPDATE organization_invitations SET revoked_at = now()
    WHERE id = ${invitationId}::uuid AND organization_id = ${organizationId}::uuid
      AND accepted_at IS NULL AND revoked_at IS NULL
    RETURNING email
  `);
  const [row] = rowsOf<{ email: string }>(result);
  if (!row) throw new AppError("NOT_FOUND", "That invitation is not pending");
  await recordOrganizationAuditEventIn(dbOrTx, organizationId, actorUserId, "invitation.revoked", null, { email: row.email });
}
export const revokeOrganizationInvitation = (organizationId: OrganizationId, invitationId: OrganizationInvitationId, actorUserId: UserId) =>
  revokeOrganizationInvitationIn(db, organizationId, invitationId, actorUserId);

/**
 * Mint a fresh bearer token for a pending invitation and bind it to the row.
 * New product-scoped delivery calls this at enqueue time, then stores the raw
 * link only in the row-bound encrypted payload. That makes provider retries
 * render the same valid link instead of rotating the token underneath
 * Resend's idempotency key. The event-scoped legacy dispatcher may still call
 * it at render time for rows queued before the product outbox existed.
 *
 * Returns `null` when the invitation is gone, already accepted, or already
 * revoked — the caller (`buildContext`) turns that into a `SkipEmail`.
 */
export async function issueOrganizationInvitationTokenIn(
  dbOrTx: DbOrTx,
  invitationId: OrganizationInvitationId,
): Promise<{ raw: string; organizationName: string; inviterEmail: string; role: MemberRole; email: string; expiresAt: Date } | null> {
  const raw = toBase64Url(randomBytes(32));
  const tokenHash = await sha256(raw);
  const result = await dbOrTx.execute(sql`
    UPDATE organization_invitations SET token_hash = ${tokenHash}
    WHERE id = ${invitationId}::uuid AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    RETURNING organization_id, email, role, expires_at
  `);
  const [row] = rowsOf<{ organization_id: string; email: string; role: MemberRole; expires_at: Date | string }>(result);
  if (!row) return null;
  const [org] = await dbOrTx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.organization_id)).limit(1);
  const inviterResult = await dbOrTx.execute(sql`
    SELECT u.email FROM organization_invitations oi JOIN users u ON u.id = oi.invited_by_user_id WHERE oi.id = ${invitationId}::uuid
  `);
  const [inviter] = rowsOf<{ email: string }>(inviterResult);
  return {
    raw,
    organizationName: org?.name ?? "Openboard",
    inviterEmail: inviter?.email ?? "A teammate",
    role: row.role,
    email: row.email,
    expiresAt: new Date(row.expires_at),
  };
}

type PendingInvitationForToken = {
  id: OrganizationInvitationId;
  organizationId: OrganizationId;
  role: MemberRole;
  email: string;
};

async function pendingOrganizationInvitationByTokenIn(
  dbOrTx: DbOrTx,
  rawToken: string,
): Promise<PendingInvitationForToken | null> {
  const tokenHash = await sha256(rawToken);
  const [row] = await dbOrTx.select({
    id: organizationInvitations.id,
    organizationId: organizationInvitations.organizationId,
    role: organizationInvitations.role,
    email: organizationInvitations.email,
  }).from(organizationInvitations)
    .where(and(
      eq(organizationInvitations.tokenHash, tokenHash),
      sql`${organizationInvitations.acceptedAt} IS NULL`,
      sql`${organizationInvitations.revokedAt} IS NULL`,
      sql`${organizationInvitations.expiresAt} > now()`,
    ))
    .limit(1);
  return row ? {
    id: row.id as OrganizationInvitationId,
    organizationId: row.organizationId as OrganizationId,
    role: row.role,
    email: row.email,
  } : null;
}

/**
 * Validate an invitation before Better Auth inserts a new user. This prevents
 * an expired, revoked, or wrong-address token from leaving behind an account
 * with no organization when the post-create hook later tries to consume it.
 */
export async function assertOrganizationInvitationTokenForEmailIn(
  dbOrTx: DbOrTx,
  rawToken: string,
  email: string,
): Promise<void> {
  const invitation = await pendingOrganizationInvitationByTokenIn(dbOrTx, rawToken);
  if (!invitation) throw new AppError("VALIDATION", "This invitation is no longer valid — ask for a new one");
  if (invitation.email !== email.trim().toLowerCase()) {
    throw new AppError("FORBIDDEN", "This invitation was sent to a different email address");
  }
}

/**
 * Consume a pending invitation and add `userId` to its organization at the
 * invited role. The `UPDATE … WHERE accepted_at IS NULL … RETURNING` is the
 * exclusivity guarantee — only one caller can ever transition a row from
 * pending to accepted — so this is safe to call twice concurrently for the
 * same invitation and have exactly one caller win.
 */
async function finalizeAcceptanceIn(
  dbOrTx: DbOrTx,
  invitationId: OrganizationInvitationId,
  userId: UserId,
): Promise<{ organizationId: OrganizationId; role: MemberRole }> {
  // Claiming the token and adding the membership are one statement. Without
  // this CTE, a database failure after the guarded invitation UPDATE could
  // permanently consume the one-shot token without granting access.
  const result = await dbOrTx.execute(sql`
    WITH invitation AS MATERIALIZED (
      SELECT organization_id, role FROM organization_invitations
      WHERE id = ${invitationId}::uuid AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    ), owners AS MATERIALIZED (
      SELECT member.user_id FROM organization_members member
      JOIN invitation ON invitation.organization_id = member.organization_id
      WHERE member.role = 'owner'
      ORDER BY member.user_id
      FOR UPDATE OF member
    ), claimed AS (
      UPDATE organization_invitations pending
      SET accepted_at = now(), accepted_user_id = ${userId}::uuid
      FROM invitation
      WHERE pending.id = ${invitationId}::uuid
        AND pending.accepted_at IS NULL
        AND pending.revoked_at IS NULL
        AND pending.expires_at > now()
        AND (
          invitation.role = 'owner'
          OR NOT EXISTS (SELECT 1 FROM owners WHERE owners.user_id = ${userId}::uuid)
          OR EXISTS (SELECT 1 FROM owners WHERE owners.user_id <> ${userId}::uuid)
        )
      RETURNING pending.organization_id, pending.role
    ), membership AS (
      INSERT INTO organization_members (user_id, organization_id, role)
      SELECT ${userId}::uuid, organization_id, role FROM claimed
      ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role
      RETURNING organization_id, role
    )
    SELECT organization_id, role FROM membership
  `);
  const [row] = rowsOf<{ organization_id: string; role: MemberRole }>(result);
  if (!row) throw new AppError("VALIDATION", "That invitation is no longer valid, or accepting it would leave the organization without an owner");
  const organizationId = row.organization_id as OrganizationId;
  try {
    await recordOrganizationAuditEventIn(dbOrTx, organizationId, userId, "invitation.accepted", userId, { role: row.role });
  } catch (error) {
    // The membership is already committed. Preserve the user's successful,
    // retry-safe acceptance and report the secondary observability failure.
    log({
      level: "error",
      msg: "organization invitation accepted without audit row",
      requestId: invitationId,
      feature: "organizations",
      code: error instanceof Error ? error.name : "unknown",
    });
  }
  return { organizationId, role: row.role };
}

/**
 * The self-service accept path: an already-authenticated identity redeems a
 * raw token from a "/join?token=…" link. Gated on the identity's own email
 * matching the invitation's — a token alone is not enough to claim membership
 * under someone else's account, only under the address it was actually sent
 * to.
 */
export async function acceptOrganizationInvitationByTokenIn(
  dbOrTx: DbOrTx,
  rawToken: string,
  identity: { userId: UserId; email: string },
): Promise<{ organizationId: OrganizationId; role: MemberRole }> {
  const invitation = await pendingOrganizationInvitationByTokenIn(dbOrTx, rawToken);
  if (!invitation) throw new AppError("VALIDATION", "This invitation is no longer valid — ask for a new one");
  if (invitation.email !== identity.email.trim().toLowerCase()) {
    throw new AppError("FORBIDDEN", "This invitation was sent to a different email address");
  }
  return finalizeAcceptanceIn(dbOrTx, invitation.id, identity.userId);
}
export const acceptOrganizationInvitationByToken = (rawToken: string, identity: { userId: UserId; email: string }) =>
  acceptOrganizationInvitationByTokenIn(db, rawToken, identity);
