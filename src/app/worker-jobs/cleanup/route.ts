import { runDataRetentionSweep } from "@/features/data-lifecycle/server/retention";
import {
  nudgeStalledFileExports,
  pruneExpiredFileExports,
} from "@/features/portal/deliverables/server/export";
import type { JobStats } from "@/shared/contracts";
import { pruneOperationalErrors } from "@/shared/server/operational-errors";
import { cleanupOrphans } from "@/shared/server/r2";
import { definePrivateJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

export const { POST } = definePrivateJobRoute("cleanup", async (): Promise<JobStats> => {
  const [orphans, retention, nudged, exports, operationalErrors] = await Promise.all([
    cleanupOrphans(),
    runDataRetentionSweep(),
    nudgeStalledFileExports(),
    pruneExpiredFileExports(),
    pruneOperationalErrors(),
  ]);
  return {
    ...orphans,
    ...retention,
    ...operationalErrors,
    nudgedStalledExports: nudged.nudged,
    // Non-zero means the backlog outran one tick's bounded batch.
    deferredStalledExports: nudged.deferred,
    deletedExpiredExports: exports.deleted,
  };
});
