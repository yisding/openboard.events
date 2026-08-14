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
    deletedExpiredExports: exports.deleted,
  };
});
