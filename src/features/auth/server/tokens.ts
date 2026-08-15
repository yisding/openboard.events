import { and, desc, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { portalTokens } from "@/db/schema";
import type { ContactId, EventId, TokenId, TokenPurpose } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { addDuration } from "@/shared/lib/time";
import { randomBytes, randomInt, sha256, toBase64Url } from "@/shared/lib/crypto";

export type IssuedPortalToken = { tokenId: TokenId; raw: string; otp?: string; expiresAt: Date };
export type ConsumedPortalToken = { contactId: ContactId; eventId: EventId };

/**
 * `randomInt`, not `% 1_000_000` over a raw draw. 2^32 is not a multiple of a
 * million, so the modulo left the first 967_296 codes reachable from 4_295
 * seeds and the rest from 4_294 — a small but free edge on a login credential.
 * The shared helper rejection-samples the short tail away, the same way
 * `publicSubmissionCode` already draws its codes.
 */
function sixDigitOtp(): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
}

export async function issuePortalToken(dbOrTx: DbOrTx, args: {
  contactId: ContactId;
  eventId: EventId;
  purpose: TokenPurpose;
  ttl: string;
  withOtp?: boolean;
}): Promise<IssuedPortalToken> {
  if (args.withOtp && args.purpose !== "magic_link") {
    throw new AppError("VALIDATION", "OTP issuance is restricted to portal login");
  }
  const raw = toBase64Url(randomBytes(32));
  const otp = args.withOtp ? sixDigitOtp() : undefined;
  const expiresAt = addDuration(new Date(), args.ttl);
  const [inserted] = await dbOrTx.insert(portalTokens).values({
    contactId: args.contactId,
    eventId: args.eventId,
    purpose: args.purpose,
    tokenHash: await sha256(raw),
    ...(otp ? { otpHash: await sha256(otp) } : {}),
    expiresAt,
  }).returning();
  if (!inserted) throw new AppError("INTERNAL", "Portal token was not created");
  return { tokenId: inserted.id as TokenId, raw, ...(otp ? { otp } : {}), expiresAt };
}

export async function verifyPortalTokenIn(dbOrTx: DbOrTx, raw: string, opts: { purpose: TokenPurpose }): Promise<ConsumedPortalToken | null> {
  const [token] = await dbOrTx.select({ contactId: portalTokens.contactId, eventId: portalTokens.eventId })
    .from(portalTokens)
    .where(and(
      eq(portalTokens.tokenHash, await sha256(raw)),
      eq(portalTokens.purpose, opts.purpose),
      isNull(portalTokens.consumedAt),
      gt(portalTokens.expiresAt, new Date()),
    ))
    .limit(1);
  return token ? { contactId: token.contactId as ContactId, eventId: token.eventId as EventId } : null;
}

export async function verifyPortalToken(raw: string, opts: { purpose: TokenPurpose }): Promise<ConsumedPortalToken | null> {
  return verifyPortalTokenIn(db, raw, opts);
}

export async function consumeToken(dbOrTx: DbOrTx, input: { raw?: string; code?: string; contactId?: ContactId }, opts: { eventId: EventId; purpose: TokenPurpose }): Promise<ConsumedPortalToken | null> {
  const now = new Date();
  if (input.raw) {
    const [consumed] = await dbOrTx.update(portalTokens)
      .set({ consumedAt: now })
      .where(and(
        eq(portalTokens.eventId, opts.eventId),
        eq(portalTokens.purpose, opts.purpose),
        eq(portalTokens.tokenHash, await sha256(input.raw)),
        isNull(portalTokens.consumedAt),
        gt(portalTokens.expiresAt, now),
        lt(portalTokens.attempts, 5),
      ))
      .returning();
    return consumed ? { contactId: consumed.contactId as ContactId, eventId: consumed.eventId as EventId } : null;
  }
  if (!input.code || !input.contactId) return null;
  const [challenge] = await dbOrTx.select({ id: portalTokens.id, otpHash: portalTokens.otpHash, attempts: portalTokens.attempts })
    .from(portalTokens)
    .where(and(
      eq(portalTokens.eventId, opts.eventId),
      eq(portalTokens.contactId, input.contactId),
      eq(portalTokens.purpose, opts.purpose),
      isNotNull(portalTokens.otpHash),
      isNull(portalTokens.consumedAt),
      gt(portalTokens.expiresAt, now),
    ))
    .orderBy(desc(portalTokens.createdAt))
    .limit(1);
  if (!challenge || challenge.attempts >= 5) return null;
  if (challenge.otpHash !== await sha256(input.code)) {
    await dbOrTx.update(portalTokens).set({
      attempts: sql`${portalTokens.attempts} + 1`,
      consumedAt: sql`CASE WHEN ${portalTokens.attempts} + 1 >= 5 THEN now() ELSE ${portalTokens.consumedAt} END`,
    }).where(and(eq(portalTokens.id, challenge.id), isNull(portalTokens.consumedAt)));
    return null;
  }
  const [consumed] = await dbOrTx.update(portalTokens)
    .set({ consumedAt: now })
    .where(and(eq(portalTokens.id, challenge.id), isNull(portalTokens.consumedAt), lt(portalTokens.attempts, 5)))
    .returning();
  return consumed ? { contactId: consumed.contactId as ContactId, eventId: consumed.eventId as EventId } : null;
}
