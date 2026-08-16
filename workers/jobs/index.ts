import { jobsForScheduledTime, runScheduledJobs, type Env } from "./dispatch";

type CronController = { scheduledTime: number };
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

const worker = {
  scheduled(controller: CronController, env: Env, ctx: WorkerContext) {
    const jobs = jobsForScheduledTime(controller.scheduledTime, {
      airtableCron: env.AIRTABLE_CRON,
      cleanupCron: env.CLEANUP_CRON,
    });
    ctx.waitUntil(runScheduledJobs(env, jobs));
  },
  async fetch() { return new Response("sb-jobs", { status: 200 }); },
};

export default worker;
