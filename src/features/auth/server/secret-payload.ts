import { z } from "zod";
import type { ContactId, EventId, TokenId, UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { randomBytes } from "./crypto";

const VERSION = 1;
const NONCE_LENGTH = 12;
const payloadSchema = z.object({ otp: z.string().regex(/^\d{6}$/u), magicLink: z.url() });
export type PortalLoginPayload = z.infer<typeof payloadSchema>;
export type PortalLoginPayloadContext = { eventId: EventId; contactId: ContactId; tokenId: TokenId };

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function configuredSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SESSION_SECRET is required for portal login delivery");
  return secret;
}

function aad(context: PortalLoginPayloadContext): Uint8Array {
  return new TextEncoder().encode(`${context.eventId}:${context.contactId}:${context.tokenId}`);
}

async function payloadKeyFor(info: string, secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info: new TextEncoder().encode(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

const payloadKey = (secret: string, usage: KeyUsage[]) => payloadKeyFor("portal_login-v1", secret, usage);

export async function sealPortalLoginPayload(payload: PortalLoginPayload, context: PortalLoginPayloadContext, secret = configuredSecret()): Promise<Uint8Array> {
  const nonce = randomBytes(NONCE_LENGTH);
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadSchema.parse(payload)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(aad(context)) },
    await payloadKey(secret, ["encrypt"]),
    plaintext,
  );
  const envelope = new Uint8Array(1 + NONCE_LENGTH + ciphertext.byteLength);
  envelope[0] = VERSION;
  envelope.set(nonce, 1);
  envelope.set(new Uint8Array(ciphertext), 1 + NONCE_LENGTH);
  return envelope;
}

export async function openPortalLoginPayload(envelope: Uint8Array, context: PortalLoginPayloadContext, secret = configuredSecret()): Promise<PortalLoginPayload> {
  if (envelope[0] !== VERSION || envelope.length <= 1 + NONCE_LENGTH + 16) {
    throw new AppError("VALIDATION", "Unsupported portal login payload");
  }
  const nonce = envelope.slice(1, 1 + NONCE_LENGTH);
  const ciphertext = envelope.slice(1 + NONCE_LENGTH);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(aad(context)) },
      await payloadKey(secret, ["decrypt"]),
      asArrayBuffer(ciphertext),
    );
    return payloadSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new AppError("VALIDATION", "Invalid portal login payload");
  }
}

/**
 * M42 — the same sealed channel for admin auth mail.
 *
 * A Better Auth password-reset or email-verification link is a bearer
 * credential with a short life, and the outbox stores rendered bodies. So it
 * travels exactly the way `portal_login`'s OTP does: encrypted at rest under
 * `SESSION_SECRET`, bound by AAD to the row that carries it, cleared by the
 * dispatcher the moment it has been rendered.
 *
 * A separate HKDF `info` string means an admin envelope can never be opened as
 * a portal-login envelope or the reverse, even though both derive from the same
 * secret.
 */
const ADMIN_LINK_INFO = "admin_auth_link-v1";
const adminLinkPayloadSchema = z.object({
  url: z.url(),
  expiresIn: z.string().min(1),
  // Product-scoped organization invitations share the durable, encrypted
  // link channel below. Auth messages omit these fields; invitation delivery
  // requires all three before rendering.
  organizationName: z.string().min(1).optional(),
  inviterName: z.string().min(1).optional(),
  invitationRole: z.enum(["organizer", "reviewer"]).optional(),
});
export type AdminLinkPayload = z.infer<typeof adminLinkPayloadSchema>;
export type AdminLinkPayloadContext = { eventId: EventId; contactId: ContactId; linkId: string };

function adminLinkAad(context: AdminLinkPayloadContext): Uint8Array {
  return new TextEncoder().encode(`${context.eventId}:${context.contactId}:${context.linkId}`);
}

export async function sealAdminLinkPayload(payload: AdminLinkPayload, context: AdminLinkPayloadContext, secret = configuredSecret()): Promise<Uint8Array> {
  const nonce = randomBytes(NONCE_LENGTH);
  const plaintext = new TextEncoder().encode(JSON.stringify(adminLinkPayloadSchema.parse(payload)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(adminLinkAad(context)) },
    await payloadKeyFor(ADMIN_LINK_INFO, secret, ["encrypt"]),
    plaintext,
  );
  const envelope = new Uint8Array(1 + NONCE_LENGTH + ciphertext.byteLength);
  envelope[0] = VERSION;
  envelope.set(nonce, 1);
  envelope.set(new Uint8Array(ciphertext), 1 + NONCE_LENGTH);
  return envelope;
}

export async function openAdminLinkPayload(envelope: Uint8Array, context: AdminLinkPayloadContext, secret = configuredSecret()): Promise<AdminLinkPayload> {
  if (envelope[0] !== VERSION || envelope.length <= 1 + NONCE_LENGTH + 16) {
    throw new AppError("VALIDATION", "Unsupported admin auth link payload");
  }
  const nonce = envelope.slice(1, 1 + NONCE_LENGTH);
  const ciphertext = envelope.slice(1 + NONCE_LENGTH);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(adminLinkAad(context)) },
      await payloadKeyFor(ADMIN_LINK_INFO, secret, ["decrypt"]),
      asArrayBuffer(ciphertext),
    );
    return adminLinkPayloadSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new AppError("VALIDATION", "Invalid admin auth link payload");
  }
}

/**
 * Product-scoped variant used by `admin_auth_email_outbox`.
 *
 * Keep a distinct HKDF context from the legacy event/contact envelope above:
 * queued rows from either outbox can coexist during a deploy, but moving a
 * ciphertext between them must never make it decryptable under different AAD.
 */
const PLATFORM_ADMIN_LINK_INFO = "platform_admin_auth_link-v1";
export type PlatformAdminLinkPayloadContext = { userId: UserId; messageId: string };

function platformAdminLinkAad(context: PlatformAdminLinkPayloadContext): Uint8Array {
  return new TextEncoder().encode(`${context.userId}:${context.messageId}`);
}

export async function sealPlatformAdminLinkPayload(
  payload: AdminLinkPayload,
  context: PlatformAdminLinkPayloadContext,
  secret = configuredSecret(),
): Promise<Uint8Array> {
  const nonce = randomBytes(NONCE_LENGTH);
  const plaintext = new TextEncoder().encode(JSON.stringify(adminLinkPayloadSchema.parse(payload)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(platformAdminLinkAad(context)) },
    await payloadKeyFor(PLATFORM_ADMIN_LINK_INFO, secret, ["encrypt"]),
    plaintext,
  );
  const envelope = new Uint8Array(1 + NONCE_LENGTH + ciphertext.byteLength);
  envelope[0] = VERSION;
  envelope.set(nonce, 1);
  envelope.set(new Uint8Array(ciphertext), 1 + NONCE_LENGTH);
  return envelope;
}

export async function openPlatformAdminLinkPayload(
  envelope: Uint8Array,
  context: PlatformAdminLinkPayloadContext,
  secret = configuredSecret(),
): Promise<AdminLinkPayload> {
  if (envelope[0] !== VERSION || envelope.length <= 1 + NONCE_LENGTH + 16) {
    throw new AppError("VALIDATION", "Unsupported platform admin auth link payload");
  }
  const nonce = envelope.slice(1, 1 + NONCE_LENGTH);
  const ciphertext = envelope.slice(1 + NONCE_LENGTH);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(platformAdminLinkAad(context)) },
      await payloadKeyFor(PLATFORM_ADMIN_LINK_INFO, secret, ["decrypt"]),
      asArrayBuffer(ciphertext),
    );
    return adminLinkPayloadSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new AppError("VALIDATION", "Invalid platform admin auth link payload");
  }
}
