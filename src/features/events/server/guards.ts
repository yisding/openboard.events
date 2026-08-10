import { getAdminSession } from "@/features/auth";
import { AppError } from "@/shared/lib/errors";
import type { HandlerGuard } from "@/shared/server/handler";

/**
 * `adminAuth()`/`adminAuth({role})` from `@/features/auth` cover every
 * eventId-scoped route (PATCH details, vocab CRUD, reorder) via `requireAdmin`.
 * Creating or listing events has no `eventId` route segment yet — there is no
 * membership row to check against a brand-new event — so those two routes use
 * this guard instead: any signed-in admin may act, and `createEvent` grants
 * the actor `owner` membership on the row it just inserted.
 */
export const eventsHubAuth = (): HandlerGuard => async () => {
  const identity = await getAdminSession();
  if (!identity) throw new AppError("UNAUTHORIZED", "Sign in required");
  return { actorId: identity.userId, role: "owner" };
};
