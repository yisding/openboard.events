import { z } from "zod";
import type { UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { openPayload, sealPayload, sealedPayloadAdditionalData } from "@/shared/server/sealed-payload";

const PLATFORM_ADMIN_LINK_INFO = "platform_admin_auth_link-v1";

export const adminLinkPayloadSchema = z.object({
  url: z.url(),
  expiresIn: z.string().min(1),
  organizationName: z.string().min(1).optional(),
  inviterName: z.string().min(1).optional(),
  invitationRole: z.enum(["organizer", "reviewer"]).optional(),
  eventName: z.string().min(1).optional(),
});
export type AdminLinkPayload = z.infer<typeof adminLinkPayloadSchema>;
export type PlatformAdminLinkPayloadContext = { userId: UserId; messageId: string };

function configuredSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SESSION_SECRET is required for admin link delivery");
  return secret;
}

export async function sealPlatformAdminLinkPayload(
  payload: AdminLinkPayload,
  context: PlatformAdminLinkPayloadContext,
  secret = configuredSecret(),
): Promise<Uint8Array> {
  return sealPayload(payload, secret, {
    schema: adminLinkPayloadSchema,
    info: PLATFORM_ADMIN_LINK_INFO,
    additionalData: sealedPayloadAdditionalData(context.userId, context.messageId),
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
    additionalData: sealedPayloadAdditionalData(context.userId, context.messageId),
    label: "platform admin auth link payload",
  });
}

