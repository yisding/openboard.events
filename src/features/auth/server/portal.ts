import { cookies } from "next/headers";
import { and, count, desc, eq, gt, gte, isNotNull, isNull } from "drizzle-orm";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import { contacts, events, portalSessions, portalTokens } from "@/db/schema";
import { getOrCreateContact } from "@/features/portal";
import type { ContactId, EventId, UserId } from "@/shared/contracts";
import { idem } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { safeInternalPath } from "../safe-next";
import { getAdminSession, requireAdmin } from "./admin";
import { PORTAL_COOKIE_PREFIX } from "../cookies";
import { randomBytes, sha256, toBase64Url } from "@/shared/lib/crypto";
import { sealPortalLoginPayload } from "./secret-payload";
import { consumeToken, issuePortalToken } from "./tokens";

const PORTAL_SESSION_SECONDS = 30 * 24 * 60 * 60;
const CONCURRENT_LOGIN_GRACE_MS = 60 * 1_000;

export type PortalSession = {
  contactId: ContactId;
  eventId: EventId;
  email: string;
  impersonatedByUserId: UserId | null;
};

export type PortalLoginRequestResult = {
  message: string;
  fallback?: { otp: string; magicLink: string };
};

export function portalCookieName(eventId: EventId): string {
  return `${PORTAL_COOKIE_PREFIX}${eventId}`;
}

function portalCookieOptions() {
  return {
    httpOnly: true,
    secure: getEnv().APP_ENV !== "local",
    sameSite: "lax" as const,
    path: "/",
    maxAge: PORTAL_SESSION_SECONDS,
  };
}

async function resolveEvent(dbOrTx: DbOrTx, eventSlug: string): Promise<{ id: EventId; slug: string }> {
  const [event] = await dbOrTx.select({ id: events.id, slug: events.slug }).from(events).where(eq(events.slug, eventSlug)).limit(1);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");
  return { id: event.id as EventId, slug: event.slug };
}

export async function createPortalSessionRowIn(dbOrTx: DbOrTx, contactId: ContactId, eventId: EventId, impersonatedByUserId: UserId | null) {
  const raw = toBase64Url(randomBytes(32));
  // Use the application clock explicitly for both timestamps. PostgreSQL's
  // `now()` is the transaction-start timestamp, so relying on the column
  // default here can make a session inserted after token consumption appear
  // older than `portal_tokens.consumed_at` to the retry-recovery query below.
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PORTAL_SESSION_SECONDS * 1_000);
  await dbOrTx.insert(portalSessions).values({
    contactId,
    eventId,
    tokenHash: await sha256(raw),
    impersonatedByUserId,
    expiresAt,
    createdAt,
  });
  return { raw, expiresAt };
}

/** A retry proves possession of the just-consumed credential, but the first
 * response may have been lost before its Set-Cookie reached the browser. Mint
 * a fresh session for the retry instead of returning cookie-less success. */
export async function createConcurrentPortalRecoverySessionIn(
  dbOrTx: DbOrTx,
  concurrent: { contactId: ContactId; email: string },
  eventId: EventId,
  impersonatedByUserId: UserId | null,
) {
  const session = await createPortalSessionRowIn(dbOrTx, concurrent.contactId, eventId, impersonatedByUserId);
  return { raw: session.raw, contactId: concurrent.contactId, email: concurrent.email, alreadySignedIn: true as const };
}

async function setPortalCookie(eventId: EventId, raw: string) {
  (await cookies()).set(portalCookieName(eventId), raw, portalCookieOptions());
}

export async function findConcurrentPortalSignInIn(
  dbOrTx: DbOrTx,
  input: { raw?: string; code?: string; contactId?: ContactId },
  opts: { eventId: EventId; purpose: "magic_link" | "impersonation" },
): Promise<{ contactId: ContactId; email: string } | null> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - CONCURRENT_LOGIN_GRACE_MS);
  const credential = input.raw
    ? eq(portalTokens.tokenHash, await sha256(input.raw))
    : input.code && input.contactId
      ? and(eq(portalTokens.contactId, input.contactId), eq(portalTokens.otpHash, await sha256(input.code)))
      : null;
  if (!credential) return null;
  const [token] = await dbOrTx.select({ contactId: portalTokens.contactId, consumedAt: portalTokens.consumedAt })
    .from(portalTokens)
    .where(and(
      eq(portalTokens.eventId, opts.eventId),
      eq(portalTokens.purpose, opts.purpose),
      credential,
      isNotNull(portalTokens.consumedAt),
      gt(portalTokens.consumedAt, cutoff),
      gt(portalTokens.expiresAt, now),
    ))
    .orderBy(desc(portalTokens.createdAt))
    .limit(1);
  if (!token?.consumedAt) return null;
  const [session] = await dbOrTx.select({ contactId: portalSessions.contactId, email: contacts.email })
    .from(portalSessions)
    .innerJoin(contacts, and(eq(contacts.id, portalSessions.contactId), eq(contacts.eventId, portalSessions.eventId)))
    .where(and(
      eq(portalSessions.eventId, opts.eventId),
      eq(portalSessions.contactId, token.contactId),
      gte(portalSessions.createdAt, token.consumedAt),
      gt(portalSessions.expiresAt, now),
    ))
    .orderBy(desc(portalSessions.createdAt))
    .limit(1);
  return session ? { contactId: session.contactId as ContactId, email: session.email } : null;
}

export async function requirePortalByEventId(eventId: EventId): Promise<PortalSession> {
  const raw = (await cookies()).get(portalCookieName(eventId))?.value;
  if (!raw) throw new AppError("UNAUTHORIZED", "Portal sign-in required");
  const [session] = await db.select({
    contactId: portalSessions.contactId,
    eventId: portalSessions.eventId,
    email: contacts.email,
    impersonatedByUserId: portalSessions.impersonatedByUserId,
  }).from(portalSessions)
    .innerJoin(contacts, and(eq(contacts.id, portalSessions.contactId), eq(contacts.eventId, portalSessions.eventId)))
    .where(and(
      eq(portalSessions.eventId, eventId),
      eq(portalSessions.tokenHash, await sha256(raw)),
      gt(portalSessions.expiresAt, new Date()),
    ))
    .limit(1);
  if (!session) throw new AppError("UNAUTHORIZED", "Portal session expired");
  return {
    contactId: session.contactId as ContactId,
    eventId: session.eventId as EventId,
    email: session.email,
    impersonatedByUserId: session.impersonatedByUserId as UserId | null,
  };
}

export async function requirePortal(eventSlug: string): Promise<PortalSession> {
  const event = await resolveEvent(db, eventSlug);
  return requirePortalByEventId(event.id);
}

export async function requestPortalLoginIn(tx: TxDb, args: {
  eventId: EventId;
  eventSlug: string;
  email: string;
  appBaseUrl: string;
  sessionSecret: string;
  fallback: boolean;
  next?: string;
}): Promise<PortalLoginRequestResult> {
  const email = args.email.trim().toLowerCase();
  const contactId = await getOrCreateContact(tx, args.eventId, email);
  const [lockedContact] = await tx.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.eventId, args.eventId), eq(contacts.email, email)))
    .limit(1)
    .for("update");
  if (!lockedContact) throw new AppError("INTERNAL", "Portal contact lock was not acquired");
  const since = new Date(Date.now() - 10 * 60 * 1_000);
  const [recent] = await tx.select({ n: count() }).from(portalTokens).where(and(
    eq(portalTokens.eventId, args.eventId),
    eq(portalTokens.contactId, contactId),
    eq(portalTokens.purpose, "magic_link"),
    isNotNull(portalTokens.otpHash),
    gt(portalTokens.createdAt, since),
  ));
  if ((recent?.n ?? 0) >= 3) {
    throw new AppError("RATE_LIMITED", "Check your inbox, or try again in a few minutes");
  }
  await tx.update(portalTokens).set({ consumedAt: new Date() }).where(and(
    eq(portalTokens.eventId, args.eventId),
    eq(portalTokens.contactId, contactId),
    eq(portalTokens.purpose, "magic_link"),
    isNotNull(portalTokens.otpHash),
    isNull(portalTokens.consumedAt),
  ));
  const issued = await issuePortalToken(tx, { contactId, eventId: args.eventId, purpose: "magic_link", ttl: "PT15M", withOtp: true });
  if (!issued.otp) throw new AppError("INTERNAL", "Portal OTP was not created");
  const returnPath = safeInternalPath(args.next, `/portal/${args.eventSlug}`);
  const magicLink = `${args.appBaseUrl}/portal/${args.eventSlug}/verify?token=${encodeURIComponent(issued.raw)}&next=${encodeURIComponent(returnPath)}`;
  const secretPayloadCiphertext = await sealPortalLoginPayload(
    { otp: issued.otp, magicLink },
    { eventId: args.eventId, contactId, tokenId: issued.tokenId },
    args.sessionSecret,
  );
  await enqueueEmail(tx, {
    eventId: args.eventId,
    contactId,
    templateKey: "portal_login",
    idempotencyKey: idem.portalLogin(args.eventId, contactId, issued.tokenId),
    secretPayloadCiphertext,
  });
  return {
    message: "If that address is on file, we've sent a code",
    ...(args.fallback ? { fallback: { otp: issued.otp, magicLink } } : {}),
  };
}

export async function requestPortalLogin(eventSlug: string, email: string, next?: string): Promise<PortalLoginRequestResult> {
  const event = await resolveEvent(db, eventSlug);
  const env = getEnv();
  if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for portal authentication");
  return withTx((tx) => requestPortalLoginIn(tx, {
    eventId: event.id,
    eventSlug,
    email,
    appBaseUrl: env.APP_BASE_URL,
    sessionSecret: env.SESSION_SECRET as string,
    fallback: env.APP_ENV !== "production" && env.EMAIL_FALLBACK_UI === "1",
    ...(next ? { next } : {}),
  }));
}

export async function verifyPortalLogin(args: { eventSlug: string; raw?: string; code?: string; email?: string; impersonate?: boolean }): Promise<PortalSession & { alreadySignedIn?: boolean }> {
  const event = await resolveEvent(db, args.eventSlug);
  const admin = args.impersonate ? await getAdminSession() : null;
  if (args.impersonate && !admin) throw new AppError("UNAUTHORIZED", "Admin sign-in required");
  if (admin) await requireAdmin(event.id, "organizer");
  const result = await withTx(async (tx) => {
    let contactId: ContactId | undefined;
    if (args.code && args.email) {
      const [contact] = await tx.select({ id: contacts.id }).from(contacts)
        .where(and(eq(contacts.eventId, event.id), eq(contacts.email, args.email.trim().toLowerCase())))
        .limit(1);
      contactId = contact?.id as ContactId | undefined;
    }
    const purpose = args.impersonate ? "impersonation" as const : "magic_link" as const;
    const credential = { ...(args.raw ? { raw: args.raw } : {}), ...(args.code ? { code: args.code } : {}), ...(contactId ? { contactId } : {}) };
    const consumed = await consumeToken(tx, credential, { eventId: event.id, purpose });
    if (!consumed) {
      const concurrent = await findConcurrentPortalSignInIn(tx, credential, { eventId: event.id, purpose });
      if (!concurrent) throw new AppError("UNAUTHORIZED", "That code or link is invalid or expired");
      return createConcurrentPortalRecoverySessionIn(tx, concurrent, event.id, admin?.userId ?? null);
    }
    const session = await createPortalSessionRowIn(tx, consumed.contactId, event.id, admin?.userId ?? null);
    const [contact] = await tx.select({ email: contacts.email }).from(contacts)
      .where(and(eq(contacts.id, consumed.contactId), eq(contacts.eventId, event.id)))
      .limit(1);
    if (!contact) throw new AppError("NOT_FOUND", "Contact not found");
    return { raw: session.raw, contactId: consumed.contactId, email: contact.email };
  });
  await setPortalCookie(event.id, result.raw);
  return {
    contactId: result.contactId,
    eventId: event.id,
    email: result.email,
    impersonatedByUserId: admin?.userId ?? null,
    ...("alreadySignedIn" in result && result.alreadySignedIn ? { alreadySignedIn: true } : {}),
  };
}

export async function logoutPortal(eventSlug: string): Promise<void> {
  const event = await resolveEvent(db, eventSlug);
  const jar = await cookies();
  const raw = jar.get(portalCookieName(event.id))?.value;
  if (raw) await db.delete(portalSessions).where(and(eq(portalSessions.eventId, event.id), eq(portalSessions.tokenHash, await sha256(raw))));
  jar.set(portalCookieName(event.id), "", { ...portalCookieOptions(), maxAge: 0 });
}

export async function createImpersonationLink(eventId: EventId, contactId: ContactId): Promise<string> {
  await requireAdmin(eventId, "organizer");
  const [event] = await db.select({ slug: events.slug }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");
  const [contact] = await db.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.eventId, eventId))).limit(1);
  if (!contact) throw new AppError("NOT_FOUND", "Contact not found");
  const issued = await issuePortalToken(db, { contactId, eventId, purpose: "impersonation", ttl: "PT5M" });
  return `/portal/${event.slug}/verify?token=${encodeURIComponent(issued.raw)}&impersonate=1`;
}
