import type { JobName, JobStats } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";

export type JobResult = { job: JobName; ok: boolean; stats: JobStats; ms: number; error?: string };

// Constant time over the longer input; length mismatch flips the accumulator once.
function safeEqual(a: string, b: string) {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

export function defineJobRoute(job: JobName, run: () => Promise<JobStats>) {
  async function POST(request: Request) {
    const secret = getEnv().CRON_SECRET;
    const provided = request.headers.get("x-cron-secret") ?? "";
    if (!secret || !provided || !safeEqual(provided, secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    }
    const started = Date.now();
    try {
      const stats = await run();
      const result: JobResult = { job, ok: true, stats, ms: Date.now() - started };
      console.log(JSON.stringify(result));
      return Response.json(result);
    } catch (error) {
      const result: JobResult = { job, ok: false, stats: {}, ms: Date.now() - started, error: String(error) };
      console.log(JSON.stringify(result));
      return Response.json(result, { status: 500 });
    }
  }
  return { POST };
}

export const stubOutbox = async (): Promise<JobStats> => ({ noop: 1 });
export const stubReminders = async (): Promise<JobStats> => ({ noop: 1 });
export const stubAirtable = async (): Promise<JobStats> => ({ noop: 1 });
export const stubCleanup = async (): Promise<JobStats> => ({ noop: 1 });
