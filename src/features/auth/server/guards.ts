import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiKeys } from "@/db/schema";
import type { ApiKeyId } from "@/shared/contracts";
import type { HandlerGuard } from "@/shared/server/handler";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { requireAdmin } from "./admin";
import { safeEqual, sha256 } from "./crypto";

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

export const apiKeyAuth = (): HandlerGuard => async (request, eventId) => {
  if (!eventId) throw new AppError("UNAUTHORIZED", "Invalid API key");
  const authorization = request.headers.get("authorization") ?? "";
  const raw = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!raw.startsWith("ob_live_")) throw new AppError("UNAUTHORIZED", "Invalid API key");
  const keyHash = await sha256(raw);
  const [key] = await db.select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.eventId, eventId), eq(apiKeys.keyHash, keyHash)))
    .limit(1);
  if (!key) throw new AppError("UNAUTHORIZED", "Invalid API key");
  void Promise.resolve(db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id))).catch(() => undefined);
  return { actorId: key.id as ApiKeyId, role: "api_key" };
};
