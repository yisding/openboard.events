import { z } from "zod";
import type { ContactId, EventId, TokenId, UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { randomBytes } from "./crypto";

const VERSION = 1;
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PORTAL_LOGIN_INFO = "portal_login-v1";
const ADMIN_LINK_INFO = "admin_auth_link-v1";
const PLATFORM_ADMIN_LINK_INFO = "platform_admin_auth_link-v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
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

function aad(...parts: string[]): Uint8Array {
  return textEncoder.encode(parts.join(":"));
}

async function payloadKeyFor(info: string, secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", textEncoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info: textEncoder.encode(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

async function sealPayload<Payload>(
  payload: Payload,
  secret: string,
  options: { schema: z.ZodType<Payload>; info: string; additionalData: Uint8Array },
): Promise<Uint8Array> {
  const nonce = randomBytes(NONCE_LENGTH);
  const plaintext = textEncoder.encode(JSON.stringify(options.schema.parse(payload)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(options.additionalData) },
    await payloadKeyFor(options.info, secret, ["encrypt"]),
    plaintext,
  );
  const envelope = new Uint8Array(1 + NONCE_LENGTH + ciphertext.byteLength);
  envelope[0] = VERSION;
  envelope.set(nonce, 1);
  envelope.set(new Uint8Array(ciphertext), 1 + NONCE_LENGTH);
  return envelope;
}

async function openPayload<Payload>(
  envelope: Uint8Array,
  secret: string,
  options: {
    schema: z.ZodType<Payload>;
    info: string;
    additionalData: Uint8Array;
    label: string;
  },
): Promise<Payload> {
  if (envelope[0] !== VERSION || envelope.length <= 1 + NONCE_LENGTH + AUTH_TAG_LENGTH) {
    throw new AppError("VALIDATION", `Unsupported ${options.label}`);
  }
  const nonce = envelope.slice(1, 1 + NONCE_LENGTH);
  const ciphertext = envelope.slice(1 + NONCE_LENGTH);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(options.additionalData) },
      await payloadKeyFor(options.info, secret, ["decrypt"]),
      asArrayBuffer(ciphertext),
    );
    return options.schema.parse(JSON.parse(textDecoder.decode(plaintext)));
  } catch {
    throw new AppError("VALIDATION", `Invalid ${options.label}`);
  }
}

export async function sealPortalLoginPayload(payload: PortalLoginPayload, context: PortalLoginPayloadContext, secret = configuredSecret()): Promise<Uint8Array> {
  return sealPayload(payload, secret, {
    schema: payloadSchema,
    info: PORTAL_LOGIN_INFO,
    additionalData: aad(context.eventId, context.contactId, context.tokenId),
  });
}

export async function openPortalLoginPayload(envelope: Uint8Array, context: PortalLoginPayloadContext, secret = configuredSecret()): Promise<PortalLoginPayload> {
  return openPayload(envelope, secret, {
    schema: payloadSchema,
    info: PORTAL_LOGIN_INFO,
    additionalData: aad(context.eventId, context.contactId, context.tokenId),
    label: "portal login payload",
  });
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
const adminLinkPayloadSchema = z.object({
  url: z.url(),
  expiresIn: z.string().min(1),
  // Product-scoped organization invitations share the durable, encrypted
  // link channel below. Auth messages omit these fields; invitation delivery
  // requires all three before rendering.
  organizationName: z.string().min(1).optional(),
  inviterName: z.string().min(1).optional(),
  invitationRole: z.enum(["organizer", "reviewer"]).optional(),
  eventName: z.string().min(1).optional(),
});
export type AdminLinkPayload = z.infer<typeof adminLinkPayloadSchema>;
export type AdminLinkPayloadContext = { eventId: EventId; contactId: ContactId; linkId: string };

export async function sealAdminLinkPayload(payload: AdminLinkPayload, context: AdminLinkPayloadContext, secret = configuredSecret()): Promise<Uint8Array> {
  return sealPayload(payload, secret, {
    schema: adminLinkPayloadSchema,
    info: ADMIN_LINK_INFO,
    additionalData: aad(context.eventId, context.contactId, context.linkId),
  });
}

export async function openAdminLinkPayload(envelope: Uint8Array, context: AdminLinkPayloadContext, secret = configuredSecret()): Promise<AdminLinkPayload> {
  return openPayload(envelope, secret, {
    schema: adminLinkPayloadSchema,
    info: ADMIN_LINK_INFO,
    additionalData: aad(context.eventId, context.contactId, context.linkId),
    label: "admin auth link payload",
  });
}

/**
 * Product-scoped variant used by `admin_auth_email_outbox`.
 *
 * Keep a distinct HKDF context from the legacy event/contact envelope above:
 * queued rows from either outbox can coexist during a deploy, but moving a
 * ciphertext between them must never make it decryptable under different AAD.
 */
export type PlatformAdminLinkPayloadContext = { userId: UserId; messageId: string };

export async function sealPlatformAdminLinkPayload(
  payload: AdminLinkPayload,
  context: PlatformAdminLinkPayloadContext,
  secret = configuredSecret(),
): Promise<Uint8Array> {
  return sealPayload(payload, secret, {
    schema: adminLinkPayloadSchema,
    info: PLATFORM_ADMIN_LINK_INFO,
    additionalData: aad(context.userId, context.messageId),
  });
}

export async function openPlatformAdminLinkPayload(
  envelope: Uint8Array,
  context: PlatformAdminLinkPayloadContext,
  secret = configuredSecret(),
): Promise<AdminLinkPayload> {
  return openPayload(envelope, secret, {
    schema: adminLinkPayloadSchema,
    info: PLATFORM_ADMIN_LINK_INFO,
    additionalData: aad(context.userId, context.messageId),
    label: "platform admin auth link payload",
  });
}
