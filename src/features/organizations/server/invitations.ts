import { and, asc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx, type TxDb } from "@/db/client";
import { events, organizationInvitations, organizations } from "@/db/schema";
import {
  idem,
  organizationInvitationDtoSchema,
  type EventId,
  type MemberRole,
  type OrganizationId,
  type OrganizationInvitationDTO,
  type OrganizationInvitationId,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { addDuration } from "@/shared/lib/time";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { getOrCreateContact } from "@/features/portal";
import { randomBytes, sha256, toBase64Url } from "@/features/auth/server/crypto";
import type { InviteOrganizationMemberInput } from "../schemas";
import { recordOrganizationAuditEventIn } from "./audit";
import { setOrganizationMemberIn } from "./mutations";

/**
 * M44 — team invitations, addressed to an email and routed through the
 * inviting organization's own outbox mail exactly the way M42's admin auth
 * mail borrows a "home event" to send from (`features/auth/server/
 * admin-mail.ts`). Resolution #4 confines `withTx` to eight named runtime
 * functions and this feature is not one of them: every write below is a
 * single statement, and where an accept has to touch two tables (the
 * invitation row and `organization_members`), the invitation's own guarded
 * `UPDATE … RETURNING` is what makes "a token is consumed at most once" a
 * database guarantee before the membership write ever runs — the same
 * sequencing `admin-mail.ts` uses (mint, then act) rather than a ninth
 * transactional path.
 */

const INVITATION_TTL = "P14D";

function rowsOf<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}

function asOutboxWriter(dbOrTx: DbOrTx): TxDb {
  return dbOrTx as TxDb;
}

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
 * The event an organization's mail is sent "from" — deterministic (oldest
 * event, then event id) for the same retry-stability reason `admin-mail.ts`'s
 * `homeEventId` is. `null` until the organization has at least one event,
 * which for a freshly self-serve-signed-up organization is true until M45's
 * event-creation flow lands; see this module's report for the seam.
 */
async function organizationHomeEventId(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<EventId | null> {
  const [row] = await dbOrTx.select({ id: events.id })
    .from(events)
    .where(eq(events.organizationId, organizationId))
    .orderBy(asc(events.createdAt), asc(events.id))
    .limit(1);
  return (row?.id as EventId | undefined) ?? null;
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
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  invitedByUserId: UserId,
  input: InviteOrganizationMemberInput,
): Promise<{ invitation: OrganizationInvitationDTO; emailQueued: boolean }> {
  const email = input.email.trim().toLowerCase();
  const expiresAt = addDuration(new Date(), INVITATION_TTL);
  // The row's own token is never used to build the mailed link — see
  // `issueOrganizationInvitationTokenIn` below — so it only has to be a valid,
  // unique placeholder until the first render mints the real one.
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

  const homeEventId = await organizationHomeEventId(dbOrTx, organizationId);
  let emailQueued = false;
  if (homeEventId) {
    const contactId = await getOrCreateContact(asOutboxWriter(dbOrTx), homeEventId, email);
    await enqueueEmail(asOutboxWriter(dbOrTx), {
      eventId: homeEventId,
      templateKey: "organization_invited",
      contactId,
      idempotencyKey: idem.organizationInvited(homeEventId, invitationId, crypto.randomUUID()),
    });
    emailQueued = true;
  }

  await recordOrganizationAuditEventIn(dbOrTx, organizationId, invitedByUserId, "member.invited", null, {
    email, role: input.role, emailQueued,
  });

  return { invitation, emailQueued };
}
export const inviteOrganizationMember = (organizationId: OrganizationId, invitedByUserId: UserId, input: InviteOrganizationMemberInput) =>
  inviteOrganizationMemberIn(db, organizationId, invitedByUserId, input);

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
 * Mint a fresh bearer token for a pending invitation and bind it to the row —
 * called at *render* time (from `features/comms/server/context.ts`), not at
 * enqueue time. This is the same trick `buildContext` already plays for every
 * other magic-link-bearing template (`issuePortalToken` in its final
 * "portal.magic_link" branch): the raw value is never persisted, only its
 * hash, so it can only ever be read back from the one rendered email it was
 * minted for. A retried render mints a new token and silently orphans the
 * previous one — harmless, because nothing was ever delivered with it.
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

export type PendingInvitationForEmail = { id: OrganizationInvitationId; organizationId: OrganizationId; role: MemberRole };

/** Used by the Better Auth signup hook to fold a new account straight into an organization it was already invited to, instead of minting it a fresh one. */
export async function findPendingInvitationByEmailIn(dbOrTx: DbOrTx, email: string): Promise<PendingInvitationForEmail | null> {
  const normalized = email.trim().toLowerCase();
  const [row] = await dbOrTx.select({ id: organizationInvitations.id, organizationId: organizationInvitations.organizationId, role: organizationInvitations.role })
    .from(organizationInvitations)
    .where(and(
      eq(organizationInvitations.email, normalized),
      sql`${organizationInvitations.acceptedAt} IS NULL`,
      sql`${organizationInvitations.revokedAt} IS NULL`,
      sql`${organizationInvitations.expiresAt} > now()`,
    ))
    .orderBy(asc(organizationInvitations.createdAt))
    .limit(1);
  return row ? { id: row.id as OrganizationInvitationId, organizationId: row.organizationId as OrganizationId, role: row.role } : null;
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
  const result = await dbOrTx.execute(sql`
    UPDATE organization_invitations SET accepted_at = now(), accepted_user_id = ${userId}::uuid
    WHERE id = ${invitationId}::uuid AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    RETURNING organization_id, role
  `);
  const [row] = rowsOf<{ organization_id: string; role: MemberRole }>(result);
  if (!row) throw new AppError("VALIDATION", "That invitation is no longer valid");
  const organizationId = row.organization_id as OrganizationId;
  await setOrganizationMemberIn(dbOrTx, organizationId, userId, row.role);
  await recordOrganizationAuditEventIn(dbOrTx, organizationId, userId, "invitation.accepted", userId, { role: row.role });
  return { organizationId, role: row.role };
}

/** Called from the Better Auth signup hook — the invitation row is already in hand. */
export const acceptOrganizationInvitationForNewUserIn = (dbOrTx: DbOrTx, invitation: PendingInvitationForEmail, userId: UserId) =>
  finalizeAcceptanceIn(dbOrTx, invitation.id, userId);

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
  const tokenHash = await sha256(rawToken);
  const [invitation] = await dbOrTx.select({ id: organizationInvitations.id, email: organizationInvitations.email })
    .from(organizationInvitations)
    .where(and(
      eq(organizationInvitations.tokenHash, tokenHash),
      sql`${organizationInvitations.acceptedAt} IS NULL`,
      sql`${organizationInvitations.revokedAt} IS NULL`,
      sql`${organizationInvitations.expiresAt} > now()`,
    ))
    .limit(1);
  if (!invitation) throw new AppError("VALIDATION", "This invitation is no longer valid — ask for a new one");
  if (invitation.email !== identity.email.trim().toLowerCase()) {
    throw new AppError("FORBIDDEN", "This invitation was sent to a different email address");
  }
  return finalizeAcceptanceIn(dbOrTx, invitation.id as OrganizationInvitationId, identity.userId);
}
export const acceptOrganizationInvitationByToken = (rawToken: string, identity: { userId: UserId; email: string }) =>
  acceptOrganizationInvitationByTokenIn(db, rawToken, identity);
