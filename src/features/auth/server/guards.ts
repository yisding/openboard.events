import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { apiKeys, events } from "@/db/schema";
import { eventIdSchema, type ApiKeyId } from "@/shared/contracts";
import type { HandlerGuard, RouteParams } from "@/shared/server/handler";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { requireAdmin } from "./admin";
import { safeEqual, sha256 } from "./crypto";
import { requirePortalByEventId } from "./portal";

export const adminAuth = (options?: { role?: "owner" | "organizer" | "reviewer" }): HandlerGuard => async (_request, eventId) => {
  if (!eventId) throw new AppError("VALIDATION", "eventId route parameter is required");
  const session = await requireAdmin(eventId, options?.role);
  return { actorId: session.userId, role: session.role };
};

export const cronAuth = (): HandlerGuard => async (request) => {
  const secret = getEnv().CRON_SECRET;
  const provided = request.headers.get("x-cron-secret") ?? "";
  if (!secret || !provided || !safeEqual(provided, secret)) throw new AppError("UNAUTHORIZED", "Invalid cron secret");
  return { actorId: "cron", role: "cron" };
};

export const publicAuth = (): HandlerGuard => async () => null;

export const portalAuth = (): HandlerGuard => async (_request, eventId) => {
  if (!eventId) throw new AppError("VALIDATION", "eventId route parameter is required");
  const session = await requirePortalByEventId(eventId);
  return { actorId: session.contactId, role: "portal" };
};

function stringParam(params: RouteParams, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

export async function authenticateApiKey(dbOrTx: DbOrTx, request: Parameters<HandlerGuard>[0], eventId: Parameters<HandlerGuard>[1], params: RouteParams) {
  const authorization = request.headers.get("authorization") ?? "";
  const raw = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!raw.startsWith("ob_live_")) throw new AppError("UNAUTHORIZED", "Invalid API key");
  const keyHash = await sha256(raw);
  const slug = stringParam(params, "slug");
  if (!eventId && !slug) throw new AppError("UNAUTHORIZED", "Invalid API key");
  const [key] = await dbOrTx.select({ id: apiKeys.id, eventId: apiKeys.eventId })
    .from(apiKeys)
    .innerJoin(events, eq(events.id, apiKeys.eventId))
    .where(and(
      eq(apiKeys.keyHash, keyHash),
      eventId ? eq(apiKeys.eventId, eventId) : eq(events.slug, slug ?? ""),
    ))
    .limit(1);
  if (!key) throw new AppError("UNAUTHORIZED", "Invalid API key");
  await dbOrTx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return { actorId: key.id as ApiKeyId, role: "api_key", eventId: eventIdSchema.parse(key.eventId) };
}

export const apiKeyAuth = (): HandlerGuard => async (request, eventId, params) => authenticateApiKey(db, request, eventId, params);
