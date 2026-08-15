import { dispatchAdminAuthEmailOutbox } from "@/features/auth/server/admin-mail";
import { dispatchOutbox } from "@/features/comms/server/dispatcher";
import type { JobStats } from "@/shared/contracts";
import { definePrivateJobRoute, settledJobStats } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = definePrivateJobRoute("outbox", async (): Promise<JobStats> => settledJobStats([
  { name: "communications", run: async () => dispatchOutbox(50) },
  {
    name: "adminAuth",
    run: async () => {
      const auth = await dispatchAdminAuthEmailOutbox(50);
      return {
        authClaimed: auth.claimed,
        authSent: auth.sent,
        authSkipped: auth.skipped,
        authFailed: auth.failed,
        authRetried: auth.retried,
      };
    },
  },
]));
