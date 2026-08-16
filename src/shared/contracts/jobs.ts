export type JobName = "outbox" | "reminders" | "cleanup" | "airtable";
export type JobStats = Record<string, number>;

/**
 * The suffix that marks a stat key as "this sweep was gated off and did
 * nothing", so that `definePrivateJobRoute` withholds the heartbeat for it.
 *
 * It lives here, in the contract both sides already import, because the gate and
 * the sweeps that produce these keys are in different layers: spelled out at
 * each end, a rename in one place turns the gate into a no-op and a sweep that
 * never ran starts reporting fresh successful scheduled work — the precise
 * failure the gate exists to prevent, and a silent one.
 */
export const SKIPPED_DISABLED_SUFFIX = "SkippedDisabled";

/** `skippedDisabledKey("airtable")` → `airtableSkippedDisabled`. */
export function skippedDisabledKey(job: JobName): string {
  return `${job}${SKIPPED_DISABLED_SUFFIX}`;
}

export const PRIVATE_JOB_PATH_PREFIX = "/worker-jobs/";
export const PRIVATE_JOB_HEADER = "x-openboard-private-job";
export const PRIVATE_JOB_HEADER_VALUE = "JobsEntrypoint";
