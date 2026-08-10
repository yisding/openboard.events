import { asc, eq } from "drizzle-orm";
import { db, type DbOrTx, type TxDb } from "@/db/client";
import { eventMembers } from "@/db/schema";
import { idem, type EventId, type TemplateKey, type UserId } from "@/shared/contracts";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { log } from "@/shared/lib/log";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { AppError } from "@/shared/lib/errors";
import { getOrCreateContact } from "@/features/portal";
import { sealAdminLinkPayload } from "./secret-payload";

/**
 * M42 — Better Auth's password-reset and email-verification mail, delivered
 * through the one outbox this codebase has (`enqueueEmail`), not through a
 * second sending path.
 *
 * The outbox is event-scoped and addressed to a `contacts` row, so admin mail
 * is too: it borrows the organizer's own event and the contact row for their
 * address, which is exactly the arrangement M50's reviewer invitation already
 * uses ("the invitation is addressed to a contact, because the outbox is",
 * `reviewers.ts`). One communication log per human, one dispatcher, one
 * suppression and bounce policy — rather than a shadow mailer that none of
 * P3-EMAIL's compliance work applies to.
 */

export type AdminAuthTemplateKey = Extract<TemplateKey, "admin_password_reset" | "admin_email_verification">;

/**
 * `enqueueEmail` is typed against `TxDb` because its other callers are the
 * audited transactional writers. This path is a single `INSERT … ON CONFLICT DO
 * NOTHING` and must not become a ninth `withTx` (PLAN resolution #4) — the same
 * cast, for the same reason, as `reviewers.ts#asOutboxWriter`.
 */
function asOutboxWriter(dbOrTx: DbOrTx): TxDb {
  return dbOrTx as TxDb;
}

/**
 * The event an admin's auth mail is sent "from".
 *
 * Deterministic by construction — oldest membership, then event id — so a retry
 * picks the same event and therefore the same contact and the same idempotency
 * key. Ordering by anything role-dependent would let a role change silently
 * move an organizer's reset mail to a different event.
 */
async function homeEventId(dbOrTx: DbOrTx, userId: UserId): Promise<EventId | null> {
  const [membership] = await dbOrTx.select({ eventId: eventMembers.eventId })
    .from(eventMembers)
    .where(eq(eventMembers.userId, userId))
    .orderBy(asc(eventMembers.createdAt), asc(eventMembers.eventId))
    .limit(1);
  return (membership?.eventId as EventId | undefined) ?? null;
}

export async function sendAdminAuthEmailIn(
  dbOrTx: DbOrTx,
  args: {
    templateKey: AdminAuthTemplateKey;
    userId: UserId;
    email: string;
    name: string;
    url: string;
    expiresIn: string;
  },
  env: RuntimeEnv = getEnv(),
): Promise<{ queued: boolean }> {
  const eventId = await homeEventId(dbOrTx, args.userId);
  if (!eventId) {
    // An account with no `event_members` row has no event to send from and no
    // admin surface to sign in to, so there is nothing useful to deliver. Log
    // it and return quietly: Better Auth's forgot-password endpoint answers
    // identically whether or not an address exists, and throwing here would
    // turn that into an account-enumeration oracle.
    log({ level: "warn", msg: "admin auth email skipped: no event membership", requestId: args.userId, feature: "auth", code: args.templateKey });
    return { queued: false };
  }

  const contactId = await getOrCreateContact(asOutboxWriter(dbOrTx), eventId, args.email.trim().toLowerCase());
  const linkId = crypto.randomUUID();
  const idempotencyKey = idem.adminAuthLink(eventId, args.templateKey, args.userId, linkId);
  const secretPayloadCiphertext = await sealAdminLinkPayload(
    { url: args.url, expiresIn: args.expiresIn },
    { eventId, contactId, linkId },
    requiredSecret(env),
  );

  await enqueueEmail(asOutboxWriter(dbOrTx), {
    eventId,
    templateKey: args.templateKey,
    contactId,
    idempotencyKey,
    secretPayloadCiphertext,
  });
  return { queued: true };
}

function requiredSecret(env: RuntimeEnv): string {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SESSION_SECRET is required for admin auth mail");
  return secret;
}

export const sendAdminAuthEmail = (args: Parameters<typeof sendAdminAuthEmailIn>[1], env?: RuntimeEnv) =>
  sendAdminAuthEmailIn(db, args, env ?? getEnv());
