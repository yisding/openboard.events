import { neon } from "@neondatabase/serverless";
import { getEnv } from "@/shared/lib/env";
import { commsHealth } from "./comms-health";

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
    const comms = await commsHealth(sql);

    return Response.json({
      ok: true,
      service: "sb-web",
      sha: env.NEXT_PUBLIC_BUILD_SHA ?? "local",
      env: appEnv,
      db: { ok: true, version },
      comms,
      ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    console.error("health check failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({
      ok: false,
      service: "sb-web",
      env: appEnv,
      db: { ok: false },
      ms: Math.round(performance.now() - started),
    }, { status: 503 });
  }
}
