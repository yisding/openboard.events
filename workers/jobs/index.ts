import { jobsForScheduledTime, runScheduledJobs, type Env } from "./dispatch";

type CronController = { scheduledTime: number };
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

const worker = {
  scheduled(controller: CronController, env: Env, ctx: WorkerContext) {
    ctx.waitUntil(runScheduledJobs(env, jobsForScheduledTime(controller.scheduledTime)));
  },
  async fetch() { return new Response("sb-jobs", { status: 200 }); },
};

export default worker;
