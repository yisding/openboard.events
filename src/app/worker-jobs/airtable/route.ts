import { runDueAirtableSyncs } from "@/features/airtable";
import type { JobStats } from "@/shared/contracts";
import { definePrivateJobRoute, settledJobStats } from "../_lib";

export const dynamic = "force-dynamic";

// `runDueAirtableSyncs` already folds its own lease reap
// (`reapExpiredSyncRunsIn` with no `eventId`, i.e. every event) into the same
// sweep and reports it as `airtableReapedRuns` — a crashed isolate's `running`
// row is cleared before the next connection is claimed, in the same
// transaction-free pass. A second, separate reap sweep here would only ever
// find zero rows left to reap and cost a redundant statement, so unlike
// `cleanup`'s independent sweeps this job has exactly one.
export const { POST } = definePrivateJobRoute("airtable", async (): Promise<JobStats> => settledJobStats([
  { name: "connections", run: () => runDueAirtableSyncs() },
]));
