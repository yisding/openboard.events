export interface Env { APP_BASE_URL: string; CRON_SECRET: string }
type CronController = { scheduledTime: number };
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

const post = (env: Env, job: string) =>
  fetch(`${env.APP_BASE_URL}/api/jobs/${job}`, { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } })
    .then(async (response) => console.log(JSON.stringify({ job, ok: response.ok, status: response.status, body: await response.text() })))
    .catch((error) => console.log(JSON.stringify({ job, ok: false, error: String(error) })));

const worker = {
  async scheduled(controller: CronController, env: Env, ctx: WorkerContext) {
    const scheduled = new Date(controller.scheduledTime);
    const minute = scheduled.getUTCMinutes();
    const jobs = ["outbox"];
    if (minute % 15 === 0) jobs.push("reminders");
    // %10 offset 5 is deliberate so airtable and reminders never share a tick.
    if (minute % 10 === 5) jobs.push("airtable");
    if (scheduled.getUTCHours() === 9 && minute === 0) jobs.push("cleanup");
    ctx.waitUntil(Promise.all(jobs.map((job) => post(env, job))));
  },
  async fetch() { return new Response("openboard-jobs", { status: 200 }); },
};

export default worker;
