import { dispatchOutbox } from "@/features/comms";
import { dispatchAdminAuthEmailOutbox } from "@/features/auth";
import { defineJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = defineJobRoute("outbox", async () => {
  const [communications, auth] = await Promise.all([
    dispatchOutbox(50),
    dispatchAdminAuthEmailOutbox(50),
  ]);
  return {
    ...communications,
    authClaimed: auth.claimed,
    authSent: auth.sent,
    authSkipped: auth.skipped,
    authFailed: auth.failed,
    authRetried: auth.retried,
  };
});
