import type { NextRequest } from "next/server";
import { AppError } from "@/shared/lib/errors";

/**
 * Origin-header CSRF defense (PLAN P3-SEC), factored out of `defineHandler`
 * so the four `/api/internal/auth/portal/*` routes — which predate
 * `defineHandler` and are gated by ambient cookies the same way any other
 * state-changing route is (`impersonate` calls `requireAdmin` directly) —
 * can call the identical check without being rebuilt onto `defineHandler`'s
 * guard/rate-limit/error-envelope machinery just for this. `defineHandler`
 * remains the chokepoint for every route built on it; this is the one
 * documented manual exception, applied consistently rather than each route
 * inventing its own check.
 *
 * Rejects a state-changing request whose `Origin` (or, failing that,
 * `Referer`) names a different origin than the one serving the request. A
 * real cross-site forgery — a form or fetch fired from an attacker's page
 * against a signed-in browser's cookies — always carries one of these
 * headers naming the attacker's origin; a same-origin call from this app's
 * own client always carries one naming this origin. Neither header is
 * guaranteed from a non-browser caller (curl, a test harness's HTTP
 * client), so their total absence is allowed rather than rejected — every
 * caller this guards has no ambient browser credential to forge in that
 * case, so there is nothing to steal.
 */
export function assertSameOrigin(request: NextRequest | Request): void {
  const declared = request.headers.get("origin") ?? request.headers.get("referer");
  if (!declared) return;
  let declaredOrigin: string;
  try {
    declaredOrigin = new URL(declared).origin;
  } catch {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected");
  }
  if (declaredOrigin !== new URL(request.url).origin) {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected");
  }
}
