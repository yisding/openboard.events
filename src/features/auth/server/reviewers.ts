import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type TxDb } from "@/db/client";
import { contacts, eventMembers, users } from "@/db/schema";
import { idem, memberRoleSchema, type ContactId, type EventId, type MemberRole, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { getOrCreateContact, updateContactFields } from "@/features/portal";
import { upsertCredentialAccount } from "./credential-account";
import { hashPassword } from "./fallback-session";

/**
 * M50 — organizer-provisioned reviewers.
 *
 * There is no separate reviewer directory: a reviewer is a `users` row plus an
 * `event_members` row with the lowest role, which is exactly what
 * `requireAdmin(eventId, "reviewer")` already understands. Provisioning
 * therefore adds an account to the existing admin-auth path rather than a
 * parallel one, and the invitation goes out through the ordinary outbox.
 */

export const reviewerInviteSchema = z.object({
  email: z.email(),
  name: z.string().trim().max(160).default(""),
  // An initial password rather than a mailed credential: the outbox stores a
  // rendered body, and a body containing a working password is a body that
  // outlives the sign-in it was for. The organizer shares it out of band.
  password: z.string().min(12).max(200),
  role: memberRoleSchema.default("reviewer"),
});
export type ReviewerInviteInput = z.infer<typeof reviewerInviteSchema>;

export type ReviewerInviteResult = {
  userId: UserId;
  email: string;
  role: MemberRole;
  createdUser: boolean;
  invited: boolean;
};

/**
 * `enqueueEmail` is typed against `TxDb` because its other callers are the
 * audited transactional writers. Provisioning is a single-statement guarded
 * path and must not become a ninth `withTx` (resolution #4); the one
 * `INSERT … ON CONFLICT DO NOTHING` it issues behaves identically on the
 * `neon-http` handle, exactly as in M36's reminder scan.
 */
function asOutboxWriter(dbOrTx: DbOrTx): TxDb {
  return dbOrTx as TxDb;
}

/**
 * Create (or reuse) an account and put it on this event.
 *
 * Two deliberate refusals to overwrite: an existing account keeps its password,
 * because provisioning a reviewer must never be a way to take over an
 * organizer's login; and an existing membership keeps its role, because adding
 * somebody as a reviewer must never *demote* an owner who is already there.
 */
export async function createEventReviewerIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: ReviewerInviteInput,
): Promise<ReviewerInviteResult> {
  if (input.role === "owner") {
    throw new AppError("VALIDATION", "Ownership is transferred, not invited");
  }
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const inserted = await dbOrTx.insert(users)
    .values({ email, name: input.name.trim() || email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning();
  let userId = inserted[0]?.id as UserId | undefined;
  const createdUser = userId !== undefined;
  let credentialHash: string | null = createdUser ? passwordHash : null;
  if (!userId) {
    const [existing] = await dbOrTx.select({ id: users.id, passwordHash: users.passwordHash })
      .from(users).where(eq(users.email, email)).limit(1);
    if (!existing) throw new AppError("INTERNAL", "Reviewer account upsert did not return a row");
    userId = existing.id as UserId;
    // Deliberately the account's *existing* hash, not the one just generated —
    // provisioning must not overwrite an organizer's password (see the doc
    // comment above). Mirroring it keeps Better Auth able to serve the same
    // credential the fallback already accepts.
    credentialHash = existing.passwordHash;
  }
  // M42 — mirror the credential into `admin_accounts` so this account can sign
  // in under either provider. See `credential-account.ts`.
  if (credentialHash) await upsertCredentialAccount(dbOrTx, userId, credentialHash);

  await dbOrTx.insert(eventMembers)
    .values({ userId, eventId, role: input.role })
    .onConflictDoNothing({ target: [eventMembers.userId, eventMembers.eventId] });

  const [membership] = await dbOrTx.select({ role: eventMembers.role }).from(eventMembers)
    .where(and(eq(eventMembers.userId, userId), eq(eventMembers.eventId, eventId))).limit(1);

  // The invitation is addressed to a contact, because the outbox is. Reusing
  // the event's own contact row keeps one communication log per human instead
  // of a shadow identity for the same address.
  const contactId: ContactId = await getOrCreateContact(asOutboxWriter(dbOrTx), eventId, email);
  if (input.name.trim()) {
    // Only fill a blank name. Every write to `contacts` goes through the two
    // exported helpers (resolution #13), and this one must not overwrite a
    // speaker's own profile just because they also review.
    const [current] = await dbOrTx.select({ firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts).where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId))).limit(1);
    if (current && current.firstName.trim() === "" && current.lastName.trim() === "") {
      const [first, ...rest] = input.name.trim().split(/\s+/u);
      await updateContactFields(dbOrTx, eventId, contactId, { firstName: first ?? "", lastName: rest.join(" ") });
    }
  }

  await enqueueEmail(asOutboxWriter(dbOrTx), {
    eventId,
    templateKey: "reviewer_invited",
    contactId,
    idempotencyKey: idem.reviewerInvited(eventId, userId),
  });

  return {
    userId,
    email,
    role: (membership?.role ?? input.role) as MemberRole,
    createdUser,
    invited: true,
  };
}

export const createEventReviewer = (eventId: EventId, input: ReviewerInviteInput) =>
  createEventReviewerIn(db, eventId, input);
