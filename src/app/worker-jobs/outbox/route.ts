import { dispatchAdminAuthEmailOutbox } from "@/features/auth/server/admin-mail";
import { dispatchOutbox } from "@/features/comms/server/dispatcher";
import type { JobStats } from "@/shared/contracts";
import { drainOutboxUntilQuiet } from "@/shared/server/outbox-engine";
import { definePrivateJobRoute, settledJobStats } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * The fifteen-minute recovery sweep. Enqueue-path nudges deliver most mail
 * within seconds; this picks up what they missed — rows in retry backoff,
 * a request that died after committing, and the reminder scan that ran just
 * before it in the same tick — and keeps claiming while batches come back
 * full (`drainOutboxUntilQuiet`) so a burst does not wait a quarter hour per
 * fifty rows.
 */
export const { POST } = definePrivateJobRoute("outbox", async (): Promise<JobStats> => settledJobStats([
  { name: "communications", run: async () => drainOutboxUntilQuiet((budget) => dispatchOutbox(budget)) },
  {
    name: "adminAuth",
    run: async () => {
      const auth = await drainOutboxUntilQuiet((budget) => dispatchAdminAuthEmailOutbox(budget));
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
