import { neon } from "@neondatabase/serverless";
import { db } from "@/db/client";
import { getEnv } from "@/shared/lib/env";
import { isAppError, retryAfterSeconds } from "@/shared/lib/errors";
import { errorMessage, log } from "@/shared/lib/log";
import { checkRateLimit, clientIp } from "@/shared/server/rate-limit";
import { commsHealth } from "./comms-health";
import { operationalErrorsHealth } from "./operational-errors-health";
import { scheduledJobsHealth } from "./scheduled-jobs-health";

export const dynamic = "force-dynamic";

/**
 * How long one probe's answer stands in for the next. Four Neon round trips —
 * a version probe plus three aggregates — used to run for every anonymous
 * request on the one public surface with no limiter in front of it, which made
 * a health check a cheap amplification lever.
 *
 * Ten seconds is chosen from what the pollers actually need: the scheduled
 * uptime check runs every fifteen *minutes*, and `scripts/post-deploy-smoke.sh`
 * retries `/api/health` for a build/deployment match inside a 240-second
 * deadline, so a ten-second reuse window is invisible to both. Nothing is
 * silently stale either — a reused answer says how old it is (`ageSeconds`).
 */
const PROBE_TTL_MS = 10_000;
const PROBE_TTL_SECONDS = Math.floor(PROBE_TTL_MS / 1000);

/**
 * The same shape every other public surface uses (`checkV1RateLimit`), sized
 * well above any first-party poller: the uptime check makes one request per
 * origin per fifteen minutes, and the deploy smoke's retry loop is bounded by
 * its own 240-second deadline. It bounds the cache-busting caller — a flood
 * with varying query strings that the reuse window above would not absorb.
 */
const HEALTH_RATE_LIMIT = { limit: 120, windowMs: 5 * 60 * 1000 };

type Probe = { body: Record<string, unknown>; status: number; at: number };

/**
 * Isolate-scoped, deliberately. Cloudflare does not edge-cache a Worker
 * response on `Cache-Control` alone, so a header would have been decoration;
 * this actually removes the round trips. It caches only successes, so a
 * recovery is visible on the very next request rather than up to ten seconds
 * after the database comes back.
 */
let lastProbe: Probe | null = null;

function healthResponse(probe: Probe, now: number): Response {
  const ageSeconds = Math.max(0, Math.round((now - probe.at) / 1000));
  return Response.json({ ...probe.body, ageSeconds }, {
    status: probe.status,
    // Honoured by any CDN or intermediary in front of the Worker, and by a
    // browser tab someone left refreshing. Not load-bearing — `lastProbe` is.
    headers: { "cache-control": `public, max-age=${PROBE_TTL_SECONDS}, s-maxage=${PROBE_TTL_SECONDS}` },
  });
}

export async function GET(request: Request) {
  try {
    await checkRateLimit(db, {
      key: `health:${clientIp(request)}`,
      limit: HEALTH_RATE_LIMIT.limit,
      windowMs: HEALTH_RATE_LIMIT.windowMs,
    });
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") {
      const retryAfter = retryAfterSeconds(error);
      return Response.json({ ok: false, service: "sb-web", error: { code: error.code, message: error.message } }, {
        status: 429,
        headers: retryAfter === undefined ? {} : { "retry-after": String(retryAfter) },
      });
    }
    // The limiter's own storage being unavailable must not take the health
    // probe down with it — the probe is how anyone finds out the database is
    // unavailable in the first place. Same degradation `defineHandler` applies.
    log({ level: "warn", msg: "health.rate_limit_degraded", requestId: "health", feature: "observability", error: errorMessage(error) });
  }

  const now = Date.now();
  if (lastProbe && now - lastProbe.at < PROBE_TTL_MS) return healthResponse(lastProbe, now);

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

    const probe: Probe = {
      status: 200,
      at: Date.now(),
      body: {
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
      },
    };
    lastProbe = probe;
    return healthResponse(probe, probe.at);
  } catch (error) {
    log({ level: "error", msg: "health.check_failed", requestId: "health", feature: "observability", error: errorMessage(error) });
    // Not cached: a failing probe is the one answer that must never outlive the
    // condition that produced it.
    lastProbe = null;
    return Response.json({
      ok: false,
      service: "sb-web",
      env: appEnv,
      db: { ok: false },
      ms: Math.round(performance.now() - started),
    }, { status: 503 });
  }
}
