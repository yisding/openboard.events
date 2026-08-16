import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import {
  advanceDemoProvisioning,
  deleteDemoEventForActor,
  demoDeleteRequestSchema,
  demoProvisionRequestSchema,
  resetDemo,
  skipDemoProvisioning,
} from "@/features/onboarding";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/**
 * First Fair — building, rebuilding and discarding an organization's one demo
 * event (design §2.7).
 *
 * `POST` is called in a loop by the provisioning screen, once per phase, and is
 * the only way a demo event comes into existence: `is_demo` is not on
 * `createEventInputSchema` and has no HTTP surface anywhere, so no request to
 * any other route can produce a plan-exempt, mail-suppressed event.
 *
 * The rate limit is sized for that loop — ten phases, plus room for a retry of
 * every one of them and a couple of resets — and for nothing else. Provisioning
 * writes roughly four hundred rows per run, which makes an unbounded POST a
 * write amplifier rather than an inconvenience.
 */
const provision = defineHandler({
  auth: organizationAuth(),
  input: demoProvisionRequestSchema,
  rateLimit: {
    limit: 40,
    windowMs: 5 * 60 * 1000,
    key: ({ params }) => `demo-provision:${typeof params.organizationId === "string" ? params.organizationId : "unknown"}`,
  },
  handler: ({ session, input, params }) => {
    const actorUserId = userIdSchema.parse(session?.actorId);
    const organizationId = requireOrganizationId(params);
    if (input.mode === "reset") return resetDemo(actorUserId, organizationId);
    if (input.mode === "skip") return skipDemoProvisioning(actorUserId, organizationId);
    return advanceDemoProvisioning(actorUserId, organizationId);
  },
});

/**
 * Owner-only, with a typed confirmation. The writer underneath puts
 * `is_demo = true` inside the DELETE's own predicate, so the worst a bug in
 * this handler can do is fail to find a row.
 */
const discard = defineHandler({
  auth: organizationAuth({ role: "owner" }),
  input: demoDeleteRequestSchema,
  handler: ({ session, params }) => deleteDemoEventForActor(
    userIdSchema.parse(session?.actorId),
    requireOrganizationId(params),
  ),
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return provision(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return discard(request, route);
}
