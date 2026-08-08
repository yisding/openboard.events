export interface Env { APP_BASE_URL: string; CRON_SECRET: string }
type CronController = { scheduledTime: number };
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

const routes = ["outbox", "reminders", "airtable", "cleanup"] as const;

const worker = {
  async scheduled(_controller: CronController, env: Env, ctx: WorkerContext) {
    const minute = new Date().getUTCMinutes();
    const active = routes.filter((route) => route === "outbox" || (route === "reminders" && minute % 15 === 0) || (route === "airtable" && minute % 10 === 0) || (route === "cleanup" && minute === 0));
    for (const route of active) {
      ctx.waitUntil(fetch(`${env.APP_BASE_URL}/api/jobs/${route}`, { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } }));
    }
  },
};

export default worker;
