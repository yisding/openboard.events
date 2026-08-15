import { runDataRetentionSweep } from "@/features/data-lifecycle/server/retention";
import {
  nudgeStalledFileExports,
  pruneExpiredFileExports,
} from "@/features/portal/deliverables/server/export";
import type { JobStats } from "@/shared/contracts";
import { pruneOperationalErrors } from "@/shared/server/operational-errors";
import { cleanupOrphans } from "@/shared/server/r2";
import { definePrivateJobRoute, settledJobStats } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = definePrivateJobRoute("cleanup", async (): Promise<JobStats> => settledJobStats([
  { name: "orphans", run: async () => cleanupOrphans() },
  { name: "retention", run: async () => runDataRetentionSweep() },
  {
    name: "stalledExports",
    run: async () => {
      const nudged = await nudgeStalledFileExports();
      // Non-zero `deferred` means the backlog outran one tick's bounded batch.
      return { nudgedStalledExports: nudged.nudged, deferredStalledExports: nudged.deferred };
    },
  },
  {
    name: "expiredExports",
    run: async () => ({ deletedExpiredExports: (await pruneExpiredFileExports()).deleted }),
  },
  { name: "operationalErrors", run: async () => pruneOperationalErrors() },
]));
