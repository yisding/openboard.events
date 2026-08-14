import { z } from "zod";
import type { ContactId, EventId, TokenId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import {
  adminLinkPayloadSchema,
  openPlatformAdminLinkPayload,
  sealPlatformAdminLinkPayload,
  type AdminLinkPayload,
} from "@/shared/server/admin-link-payload";
import { openPayload, sealPayload, sealedPayloadAdditionalData } from "@/shared/server/sealed-payload";

const PORTAL_LOGIN_INFO = "portal_login-v1";
const ADMIN_LINK_INFO = "admin_auth_link-v1";
const payloadSchema = z.object({ otp: z.string().regex(/^\d{6}$/u), magicLink: z.url() });
export type PortalLoginPayload = z.infer<typeof payloadSchema>;
export type PortalLoginPayloadContext = { eventId: EventId; contactId: ContactId; tokenId: TokenId };

function configuredSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SESSION_SECRET is required for portal login delivery");
  return secret;
}


export async function sealPortalLoginPayload(payload: PortalLoginPayload, context: PortalLoginPayloadContext, secret = configuredSecret()): Promise<Uint8Array> {
  return sealPayload(payload, secret, {
    schema: payloadSchema,
    info: PORTAL_LOGIN_INFO,
    additionalData: sealedPayloadAdditionalData(context.eventId, context.contactId, context.tokenId),
  });
}

export async function openPortalLoginPayload(envelope: Uint8Array, context: PortalLoginPayloadContext, secret = configuredSecret()): Promise<PortalLoginPayload> {
  return openPayload(envelope, secret, {
    schema: payloadSchema,
    info: PORTAL_LOGIN_INFO,
    additionalData: sealedPayloadAdditionalData(context.eventId, context.contactId, context.tokenId),
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
export type { AdminLinkPayload } from "@/shared/server/admin-link-payload";
export type AdminLinkPayloadContext = { eventId: EventId; contactId: ContactId; linkId: string };

export async function openAdminLinkPayload(envelope: Uint8Array, context: AdminLinkPayloadContext, secret = configuredSecret()): Promise<AdminLinkPayload> {
  return openPayload(envelope, secret, {
    schema: adminLinkPayloadSchema,
    info: ADMIN_LINK_INFO,
    additionalData: sealedPayloadAdditionalData(context.eventId, context.contactId, context.linkId),
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
export { openPlatformAdminLinkPayload, sealPlatformAdminLinkPayload };
