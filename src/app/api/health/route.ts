import { neon } from "@neondatabase/serverless";
import { getEnv } from "@/shared/lib/env";
import { errorMessage, log } from "@/shared/lib/log";
import { commsHealth } from "./comms-health";
import { operationalErrorsHealth } from "./operational-errors-health";
import { scheduledJobsHealth } from "./scheduled-jobs-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  let appEnv = "unknown";

  try {
    const env = getEnv();
    appEnv = env.APP_ENV;
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

    const sql = neon(env.DATABASE_URL);
    const rows = await sql`select current_setting('server_version') as version`;
    const version = typeof rows[0]?.version === "string" ? rows[0].version : "unknown";
    const [comms, errors, jobs] = await Promise.all([
      commsHealth(sql),
      operationalErrorsHealth(sql),
      scheduledJobsHealth(sql),
    ]);

    return Response.json({
      ok: true,
      service: "sb-web",
      sha: env.BUILD_SHA ?? "local",
      deployment: env.DEPLOYMENT_ID ?? "local",
      env: appEnv,
      db: { ok: true, version },
      comms,
      errors,
      jobs,
      ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    log({ level: "error", msg: "health.check_failed", requestId: "health", feature: "observability", error: errorMessage(error) });
    return Response.json({
      ok: false,
      service: "sb-web",
      env: appEnv,
      db: { ok: false },
      ms: Math.round(performance.now() - started),
    }, { status: 503 });
  }
}
