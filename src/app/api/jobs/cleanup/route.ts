import { runDataRetentionSweep } from "@/features/data-lifecycle";
import { pruneExpiredFileExports } from "@/features/portal/deliverables";
import type { JobStats } from "@/shared/contracts";
import { cleanupOrphans } from "@/shared/server/r2";
import { defineJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

// M47: the retention sweep (expired tokens/sessions, aged rendered email
// bodies) shares this slot with the pre-existing R2 orphan sweep — both are
// best-effort, independent-statement daily sweeps with no cross-dependency,
// so either can fail without blocking the other's stats from being reported.
//
// P3-OPS: M52's `pruneExpiredFileExports` shares the slot too. It is the sole
// owner of expiry-based cleanup for completed export ZIPs (`ORPHAN_PREDICATE_SQL`
// deliberately excludes any `file_assets` row a `file_export_jobs.result_file_id`
// still points to, so `cleanupOrphans` above never reclaims one) — without this
// call it was dead code and completed exports never got cleaned up at all.
export const { POST } = defineJobRoute("cleanup", async (): Promise<JobStats> => {
  const [orphans, retention, exports] = await Promise.all([cleanupOrphans(), runDataRetentionSweep(), pruneExpiredFileExports()]);
  return { ...orphans, ...retention, deletedExpiredExports: exports.deleted };
});
