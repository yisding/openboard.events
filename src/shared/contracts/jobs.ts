export type JobName = "outbox" | "reminders" | "cleanup" | "r2-migration";
export type JobStats = Record<string, number>;

export const PRIVATE_JOB_PATH_PREFIX = "/worker-jobs/";
export const PRIVATE_JOB_HEADER = "x-openboard-private-job";
export const PRIVATE_JOB_HEADER_VALUE = "JobsEntrypoint";
