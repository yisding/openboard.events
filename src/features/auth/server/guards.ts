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

/**
 * Every `/api/internal/[eventId]/…` route's guard. `role` defaults to
 * `"organizer"`, the same default `agendaAuth` and `tasksAdminAuth` already
 * use, and the same bar `requiredRoleForEventPath` puts on every admin page
 * outside `/events/[eventId]/review`.
 *
 * Membership is not a role. Without a default, `authorizeAdmin` is satisfied by
 * *any* `event_members` row, so a bare guard admitted a reviewer to every
 * organizer surface — including the speaker roster, whose names, emails and
 * per-contact submission codes/titles join straight back to the blind queue and
 * undo an `anonymize_authors` round. The default is therefore fail-closed: a
 * route a reviewer genuinely needs (their queue, their own scoring, the
 * submission they were assigned) opts in with an explicit
 * `{ role: "reviewer" }`, which is grep-able and checked by
 * `scripts/check-invariants.sh`.
 */
export const adminAuth = (options?: { role?: "owner" | "organizer" | "reviewer" }): HandlerGuard => async (_request, eventId) => {
  if (!eventId) throw new AppError("VALIDATION", "eventId route parameter is required");
  const session = await requireAdmin(eventId, options?.role ?? "organizer");
  return { actorId: session.userId, role: session.role };
};

// Shared-secret header, not a browser cookie: a cross-site page cannot forge
// it, so this guard is exempt from defineHandler's origin check.
export const cronAuth = (): HandlerGuard => Object.assign(
  (async (request: Parameters<HandlerGuard>[0]) => {
    const secret = getEnv().CRON_SECRET;
    const provided = request.headers.get("x-cron-secret") ?? "";
    if (!secret || !provided || !safeEqual(provided, secret)) throw new AppError("UNAUTHORIZED", "Invalid cron secret");
    return { actorId: "cron", role: "cron" };
  }) as HandlerGuard,
  { csrfExempt: true },
);

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

// Bearer token, not a browser cookie: same exemption rationale as cronAuth.
export const apiKeyAuth = (): HandlerGuard => Object.assign(
  (async (request, eventId, params) => authenticateApiKey(db, request, eventId, params)) as HandlerGuard,
  { csrfExempt: true },
);
