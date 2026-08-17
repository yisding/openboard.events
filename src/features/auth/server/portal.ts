import { cookies } from "next/headers";
import { and, count, desc, eq, gt, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import { contacts, events, portalSessions, portalTokens, users } from "@/db/schema";
import type { ContactId, EventId, FormId, UserId } from "@/shared/contracts";
import { idem } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { getOrCreateContact } from "@/features/event-contacts";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { safeInternalPath } from "../safe-next";
import { getAdminSession, requireAdmin } from "./admin";
import { PORTAL_COOKIE_PREFIX } from "../cookies";
import { randomBytes, sha256, toBase64Url } from "@/shared/lib/crypto";
import { sealPortalLoginPayload } from "./secret-payload";
import { consumeToken, issuePortalToken } from "./tokens";

const PORTAL_SESSION_SECONDS = 30 * 24 * 60 * 60;
const CONCURRENT_LOGIN_GRACE_MS = 60 * 1_000;

/**
 * How long an impersonation link stays usable.
 *
 * It used to be five minutes, and the confirm interstitial in front of it spent
 * them: the verify page deliberately does not sign anyone in on load, so an
 * organizer who opened the tab and was pulled away for one phone call came back
 * to "That link is invalid or expired". A short TTL is not what makes this link
 * safe anyway — it never leaves the organizer's own browser (no email carries
 * it), and spending it still requires a live organizer session on the event, so
 * the window is a nuisance to its owner long before it is a defence. Half an
 * hour covers the interruption; `renewImpersonationSession` covers the rest.
 */
const IMPERSONATION_TTL = "PT30M";

/**
 * The one answer the public sign-in form gives, whoever typed into it. It has
 * to be byte-identical on both branches below — an address on file and an
 * address that is not — or the screen itself becomes the account-enumeration
 * oracle the neutral wording exists to close.
 */
export const PORTAL_LOGIN_NEUTRAL_MESSAGE = "If that address is on file, we've sent a code";

/** How long a login request is throttled for, and how many are allowed inside it. */
export const PORTAL_LOGIN_THROTTLE = { limit: 3, windowMs: 10 * 60 * 1_000 } as const;
export const PORTAL_LOGIN_THROTTLE_MESSAGE = "Check your inbox, or try again in a few minutes";

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

/**
 * Who opened an impersonated portal session. The banner names the speaker being
 * viewed; without this it names nobody accountable, so on a shared machine
 * there is no way to tell from the portal which organizer started the session.
 */
export async function getPortalImpersonator(userId: UserId): Promise<{ name: string; email: string } | null> {
  const [user] = await db.select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  return { name: user.name.trim() || user.email, email: user.email };
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
  /**
   * The caller is the account step of an **open public call for speakers**, so
   * an address with no contact row is a first-time submitter rather than a
   * stranger typing into a sign-in box.
   *
   * Never taken from the request body. `requestPortalLogin` sets it only after
   * resolving the form itself and finding a `cfp` form in the open state —
   * which is exactly the surface an organizer published to invite people who
   * are, by definition, not on the roster yet.
   */
  mayCreateContact?: boolean;
}): Promise<PortalLoginRequestResult> {
  const email = args.email.trim().toLowerCase();
  // Look the recipient up; never create them *here*. This form is
  // unauthenticated, so a `getOrCreateContact` on the sign-in path let anyone
  // mint a permanent roster row per typed address — the organizer's Speakers
  // list filled with people who never existed, each one "Awaiting
  // confirmation, 0 submissions". A speaker signing in always has a contact row
  // already: the organizer added them, or their CFP submission created one.
  //
  // The one caller that legitimately arrives before that row exists is the CFP
  // account step, and it says so — see `mayCreateContact`. Without that door a
  // published call for speakers is open to nobody: every visitor starts on the
  // account step, the draft endpoint requires a portal session, and the only
  // way to get one is the code this function refuses to issue.
  const [lockedContact] = await tx.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.eventId, args.eventId), eq(contacts.email, email)))
    .limit(1)
    .for("update");
  // The neutral answer, not a 404: whether an address is on file is exactly
  // what this endpoint refuses to disclose. The caller applies the same
  // per-address throttle either way, so the *rate limit* cannot answer it
  // either — see the login request route. This stays true with
  // `mayCreateContact` on: both branches then issue a code and return the same
  // sentence, so the reply still says nothing about who is on file.
  if (!lockedContact && !args.mayCreateContact) return { message: PORTAL_LOGIN_NEUTRAL_MESSAGE };
  const contactId = lockedContact
    ? lockedContact.id as ContactId
    : await getOrCreateContact(tx, args.eventId, email);
  const since = new Date(Date.now() - PORTAL_LOGIN_THROTTLE.windowMs);
  const [recent] = await tx.select({ n: count() }).from(portalTokens).where(and(
    eq(portalTokens.eventId, args.eventId),
    eq(portalTokens.contactId, contactId),
    eq(portalTokens.purpose, "magic_link"),
    isNotNull(portalTokens.otpHash),
    gt(portalTokens.createdAt, since),
  ));
  if ((recent?.n ?? 0) >= PORTAL_LOGIN_THROTTLE.limit) {
    throw new AppError("RATE_LIMITED", PORTAL_LOGIN_THROTTLE_MESSAGE);
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
    message: PORTAL_LOGIN_NEUTRAL_MESSAGE,
    ...(args.fallback ? { fallback: { otp: issued.otp, magicLink } } : {}),
  };
}

/**
 * `formId` marks the request as coming from a call-for-speakers account step.
 *
 * It is a *hint about which surface asked*, never a grant: the answer to "may
 * this mint a contact row" is computed here, from the form as stored. A caller
 * that passes the id of a portal form, a draft form, or a form that has closed
 * gets the same never-create behaviour as the plain sign-in box.
 */
export async function requestPortalLogin(
  eventSlug: string,
  email: string,
  next?: string,
  formId?: FormId,
): Promise<PortalLoginRequestResult> {
  const event = await resolveEvent(db, eventSlug);
  const env = getEnv();
  if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for portal authentication");
  const mayCreateContact = formId ? await publicCfpIsOpenIn(db, event.id, formId) : false;
  return withTx((tx) => requestPortalLoginIn(tx, {
    eventId: event.id,
    eventSlug,
    email,
    appBaseUrl: env.APP_BASE_URL,
    sessionSecret: env.SESSION_SECRET as string,
    fallback: env.APP_ENV !== "production" && env.EMAIL_FALLBACK_UI === "1",
    ...(next ? { next } : {}),
    ...(mayCreateContact ? { mayCreateContact } : {}),
  }));
}

/**
 * Is this form a call for speakers, on this event, open at this instant?
 *
 * Asked of `is_form_open` rather than of a copy of its rules in TypeScript.
 * That function is what the submit transaction itself is gated on, so this
 * cannot drift into promising a code for a window the write would then refuse
 * — and it re-reads `clock_timestamp()`, which matters because the window can
 * close between the page render and the code request.
 *
 * `context = 'cfp'` and the event scope are checked alongside it: a portal
 * form is an authenticated surface, and a form id belonging to another event
 * must not act as a door into this one.
 */
export async function publicCfpIsOpenIn(dbOrTx: DbOrTx, eventId: EventId, formId: FormId): Promise<boolean> {
  const result = await dbOrTx.execute<{ open: boolean }>(sql`
    SELECT is_form_open(f.id) AS open
    FROM forms f
    WHERE f.id = ${formId} AND f.event_id = ${eventId} AND f.context = 'cfp'
    LIMIT 1
  `);
  return result.rows?.[0]?.open === true;
}

export type PortalLoginVerification =
  | { verified: true; raw: string; contactId: ContactId; email: string; alreadySignedIn?: true }
  | { verified: false };

/**
 * The transactional half of a portal sign-in. A **refusal is returned, never
 * thrown**, and that is the whole point of the split.
 *
 * `consumeToken` spends one of the five OTP guesses by incrementing
 * `portal_tokens.attempts` (and burning the token at five). Throwing the
 * `UNAUTHORIZED` from inside this transaction rolled that increment back with
 * everything else, so the counter never left zero and the brute-force lockout
 * never engaged — unlimited guesses at a six-digit login credential. Returning
 * lets the transaction commit the guess it just spent; the caller turns
 * `{ verified: false }` into the same `UNAUTHORIZED` the speaker saw before.
 *
 * The success path is untouched and still atomic: a correct code burns its
 * token and mints its session together, or neither happens.
 */
export async function verifyPortalLoginIn(tx: TxDb, args: {
  eventId: EventId;
  purpose: "magic_link" | "impersonation";
  raw?: string;
  code?: string;
  email?: string;
  impersonatedByUserId: UserId | null;
}): Promise<PortalLoginVerification> {
  let contactId: ContactId | undefined;
  if (args.code && args.email) {
    const [contact] = await tx.select({ id: contacts.id }).from(contacts)
      .where(and(eq(contacts.eventId, args.eventId), eq(contacts.email, args.email.trim().toLowerCase())))
      .limit(1);
    contactId = contact?.id as ContactId | undefined;
  }
  const credential = { ...(args.raw ? { raw: args.raw } : {}), ...(args.code ? { code: args.code } : {}), ...(contactId ? { contactId } : {}) };
  const consumed = await consumeToken(tx, credential, { eventId: args.eventId, purpose: args.purpose });
  if (!consumed) {
    const concurrent = await findConcurrentPortalSignInIn(tx, credential, { eventId: args.eventId, purpose: args.purpose });
    if (!concurrent) return { verified: false };
    const recovered = await createConcurrentPortalRecoverySessionIn(tx, concurrent, args.eventId, args.impersonatedByUserId);
    return { verified: true, raw: recovered.raw, contactId: recovered.contactId, email: recovered.email, alreadySignedIn: true };
  }
  const session = await createPortalSessionRowIn(tx, consumed.contactId, args.eventId, args.impersonatedByUserId);
  const [contact] = await tx.select({ email: contacts.email }).from(contacts)
    .where(and(eq(contacts.id, consumed.contactId), eq(contacts.eventId, args.eventId)))
    .limit(1);
  if (!contact) throw new AppError("NOT_FOUND", "Contact not found");
  return { verified: true, raw: session.raw, contactId: consumed.contactId, email: contact.email };
}

export async function verifyPortalLogin(args: { eventSlug: string; raw?: string; code?: string; email?: string; impersonate?: boolean }): Promise<PortalSession & { alreadySignedIn?: boolean }> {
  const event = await resolveEvent(db, args.eventSlug);
  const admin = args.impersonate ? await getAdminSession() : null;
  if (args.impersonate && !admin) throw new AppError("UNAUTHORIZED", "Admin sign-in required");
  if (admin) await requireAdmin(event.id, "organizer");
  const result = await withTx((tx) => verifyPortalLoginIn(tx, {
    eventId: event.id,
    purpose: args.impersonate ? "impersonation" : "magic_link",
    ...(args.raw ? { raw: args.raw } : {}),
    ...(args.code ? { code: args.code } : {}),
    ...(args.email ? { email: args.email } : {}),
    impersonatedByUserId: admin?.userId ?? null,
  }));
  // Thrown out here, after the commit, so the spent guess survives the refusal.
  if (!result.verified) throw new AppError("UNAUTHORIZED", "That code or link is invalid or expired");
  await setPortalCookie(event.id, result.raw);
  return {
    contactId: result.contactId,
    eventId: event.id,
    email: result.email,
    impersonatedByUserId: admin?.userId ?? null,
    ...(result.alreadySignedIn ? { alreadySignedIn: true } : {}),
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
  const issued = await issuePortalToken(db, { contactId, eventId, purpose: "impersonation", ttl: IMPERSONATION_TTL });
  return `/portal/${event.slug}/verify?token=${encodeURIComponent(issued.raw)}&impersonate=1`;
}

/**
 * Which speaker an impersonation link was minted for — answered from a spent or
 * long-expired token as readily as from a live one.
 *
 * Deliberately *not* a credential check: the token is read here only to
 * remember which contact the organizer picked in the admin tab. What authorizes
 * the renewal is the caller's live organizer session, the same guard
 * `createImpersonationLink` runs before minting the first link. The join to
 * `contacts` keeps a link to an erased speaker from resurrecting them.
 */
async function impersonationLinkContactIn(dbOrTx: DbOrTx, eventId: EventId, raw: string): Promise<ContactId | null> {
  const [token] = await dbOrTx.select({ contactId: contacts.id })
    .from(portalTokens)
    .innerJoin(contacts, and(eq(contacts.id, portalTokens.contactId), eq(contacts.eventId, portalTokens.eventId)))
    .where(and(
      eq(portalTokens.eventId, eventId),
      eq(portalTokens.purpose, "impersonation"),
      eq(portalTokens.tokenHash, await sha256(raw)),
    ))
    .limit(1);
  return (token?.contactId as ContactId | undefined) ?? null;
}

/**
 * The way back from an impersonation link that expired behind its own confirm
 * interstitial. The organizer is looking at the verify page holding a link that
 * no longer verifies, and the only re-issue path used to be a different tab —
 * one they may well have closed.
 *
 * This mints a replacement for the same speaker and spends it in the same
 * transaction, so the organizer's one click lands them in the portal instead of
 * at a second interstitial they have already read. That skips no check the
 * first click passes: it is a same-origin POST from a page the organizer asked
 * for, carrying the link itself, and it re-runs the organizer guard against the
 * event. The token table still records both the issue and the use.
 */
export async function renewImpersonationSession(args: { eventSlug: string; token: string }): Promise<PortalSession> {
  const admin = await getAdminSession();
  if (!admin) throw new AppError("UNAUTHORIZED", "Admin sign-in required");
  const event = await resolveEvent(db, args.eventSlug);
  await requireAdmin(event.id, "organizer");
  const contactId = await impersonationLinkContactIn(db, event.id, args.token);
  if (!contactId) throw new AppError("NOT_FOUND", "That impersonation link no longer matches a speaker on this event");
  const result = await withTx(async (tx) => {
    const issued = await issuePortalToken(tx, { contactId, eventId: event.id, purpose: "impersonation", ttl: IMPERSONATION_TTL });
    return verifyPortalLoginIn(tx, { eventId: event.id, purpose: "impersonation", raw: issued.raw, impersonatedByUserId: admin.userId });
  });
  if (!result.verified) throw new AppError("INTERNAL", "Unable to reopen the speaker portal");
  await setPortalCookie(event.id, result.raw);
  return { contactId: result.contactId, eventId: event.id, email: result.email, impersonatedByUserId: admin.userId };
}
