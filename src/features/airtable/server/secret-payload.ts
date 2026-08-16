import { z } from "zod";
import type { AirtableConnectionId, EventId } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { AppError } from "@/shared/lib/errors";
import { openPayload, sealPayload, sealedPayloadAdditionalData } from "@/shared/server/sealed-payload";

/**
 * M39 — the customer's Airtable personal access token at rest.
 *
 * Same seam as `portal_login` and the admin auth links, with its own HKDF
 * context so an envelope sealed for one purpose can never be opened as
 * another even though all three derive from `SESSION_SECRET`. The AAD binds
 * the ciphertext to `(eventId, connectionId)`: copying `token_ciphertext`
 * onto another event's row produces an envelope that will not open, which
 * turns a would-be cross-tenant credential lift into a `VALIDATION` throw.
 *
 * This is the only module that ever holds the plaintext PAT in a variable
 * outside the one request that received it.
 */

const AIRTABLE_PAT_INFO = "airtable_pat-v1";

const payloadSchema = z.object({ pat: z.string().min(12) });
export type AirtablePatPayload = z.infer<typeof payloadSchema>;
export type AirtablePatContext = { eventId: EventId; connectionId: AirtableConnectionId };

function configuredSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SESSION_SECRET is required to store an Airtable token");
  return secret;
}

function additionalData(context: AirtablePatContext): Uint8Array {
  return sealedPayloadAdditionalData(context.eventId, context.connectionId);
}

export async function sealAirtablePat(
  payload: AirtablePatPayload,
  context: AirtablePatContext,
  secret = configuredSecret(),
): Promise<Uint8Array> {
  return sealPayload(payload, secret, {
    schema: payloadSchema,
    info: AIRTABLE_PAT_INFO,
    additionalData: additionalData(context),
  });
}

export async function openAirtablePat(
  envelope: Uint8Array,
  context: AirtablePatContext,
  secret = configuredSecret(),
): Promise<AirtablePatPayload> {
  return openPayload(envelope, secret, {
    schema: payloadSchema,
    info: AIRTABLE_PAT_INFO,
    additionalData: additionalData(context),
    label: "Airtable token",
  });
}

/** Last four characters, the only part of a token that ever reaches a response body. */
export function airtablePatHint(pat: string): string {
  return pat.slice(-4);
}

/**
 * Answers "is this the same token they pasted last time?" and support's "is it
 * the token they think it is?" without anything unsealing an envelope. Stored
 * alongside the ciphertext, never returned to a client.
 */
export async function airtablePatFingerprint(pat: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pat));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
