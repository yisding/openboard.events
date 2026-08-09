import { z } from "zod";
import type { ContactId, EventId, TokenId } from "@/shared/contracts";
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

async function payloadKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info: new TextEncoder().encode("portal_login-v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

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
