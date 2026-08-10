import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { contacts, events } from "@/db/schema";
import { contactIdSchema, eventIdSchema, type ContactId, type EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";

const ISSUER = "openboard";
const AUDIENCE = "openboard:task-reminder-unsubscribe";
const unsubscribeClaimsSchema = z.object({
  purpose: z.literal("task_reminder_unsubscribe"),
  eventId: eventIdSchema,
  contactId: contactIdSchema,
});

type UnsubscribeClaims = z.infer<typeof unsubscribeClaimsSchema>;

// M46 — signed with the dedicated `UNSUBSCRIBE_SECRET`, not `SESSION_SECRET`
// (see that env var's schema comment): an unsubscribe token's lifecycle
// (365-day expiry, handed to a third-party inbox) has nothing to do with an
// admin session's, and sharing a key meant the two could never rotate
// independently.
function configuredSecret(): string {
  const secret = getEnv().UNSUBSCRIBE_SECRET;
  if (!secret) throw new AppError("INTERNAL", "UNSUBSCRIBE_SECRET is required for unsubscribe links");
  return secret;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signUnsubscribeToken(
  claims: { eventId: EventId; contactId: ContactId },
  secret = configuredSecret(),
): Promise<string> {
  return new SignJWT({ ...claims, purpose: "task_reminder_unsubscribe" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(secretKey(secret));
}

export async function verifyUnsubscribeToken(token: string, secret = configuredSecret()): Promise<UnsubscribeClaims | null> {
  try {
    const verified = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return unsubscribeClaimsSchema.parse(verified.payload);
  } catch {
    return null;
  }
}

async function unsubscribeTargetIn(
  dbOrTx: DbOrTx,
  eventSlug: string,
  token: string,
  secret?: string,
): Promise<{ eventId: EventId; contactId: ContactId } | null> {
  const claims = await verifyUnsubscribeToken(token, secret);
  if (!claims) return null;
  const [event] = await dbOrTx.select({ id: events.id }).from(events).where(and(eq(events.id, claims.eventId), eq(events.slug, eventSlug))).limit(1);
  return event ? { eventId: claims.eventId, contactId: claims.contactId } : null;
}

// P3-EMAIL: this token/flag now gates every non-essential template, not only
// `task_reminder` — see `isTransactionalTemplate` in shared/contracts/comms.ts
// for the fleet-wide policy `buildContext` enforces. Names below are kept as
// `…FromReminders` (the JWT `purpose` claim stays `task_reminder_unsubscribe`
// too) to avoid an unrelated rename churning this module; the behavior, not
// the name, is what widened.
export function canUnsubscribeFromReminders(eventSlug: string, token: string): Promise<boolean> {
  return unsubscribeTargetIn(db, eventSlug, token).then(Boolean);
}

export async function unsubscribeFromRemindersIn(
  dbOrTx: DbOrTx,
  eventSlug: string,
  token: string,
  secret?: string,
): Promise<boolean> {
  const target = await unsubscribeTargetIn(dbOrTx, eventSlug, token, secret);
  if (!target) return false;
  const [updated] = await dbOrTx.update(contacts).set({ unsubscribedAt: new Date() }).where(and(
    eq(contacts.id, target.contactId),
    eq(contacts.eventId, target.eventId),
  )).returning();
  return Boolean(updated);
}

export function unsubscribeFromReminders(eventSlug: string, token: string): Promise<boolean> {
  return unsubscribeFromRemindersIn(db, eventSlug, token);
}
