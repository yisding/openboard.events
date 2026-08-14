import { z } from "zod";
import { AppError } from "@/shared/lib/errors";
import { randomBytes } from "@/shared/lib/crypto";

const VERSION = 1;
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export function sealedPayloadAdditionalData(...parts: string[]): Uint8Array {
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

export async function sealPayload<Payload>(
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

export async function openPayload<Payload>(
  envelope: Uint8Array,
  secret: string,
  options: { schema: z.ZodType<Payload>; info: string; additionalData: Uint8Array; label: string },
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

