const REQUEST_COUNT = 12;
const REQUEST_TIMEOUT_MS = 10_000;
const P95_LATENCY_BUDGET_MS = 5_000;
// Mirrors the per-IP short-burst counter in `app/api/auth/[...action]/route.ts`
// (`CREDENTIAL_BURST_WINDOW_MS`, and the `auth-signin-burst:ip:*` limit). The
// window is a fixed one that rolls forward, so a burst that takes longer than
// one window to drain legitimately admits one more request per window it spans
// — asserting a single admission would fail whenever the edge is slow enough to
// push the burst past 1s, which is most of the time under load.
const BURST_WINDOW_MS = 1_000;
const IP_BURST_LIMIT = 1;

type Sample = { status: number; durationMs: number };

async function sample(url: URL, origin: string, email: string): Promise<Sample> {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      email,
      password: "capacity probe credential that cannot be valid",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  return { status: response.status, durationMs: Math.round(performance.now() - startedAt) };
}

async function main(): Promise<void> {
  const rawBaseUrl = process.argv[2] ?? process.env.APP_BASE_URL;
  if (!rawBaseUrl) throw new Error("usage: probe-admin-signin-capacity.ts <base-url>");

  const baseUrl = new URL(rawBaseUrl);
  const signInUrl = new URL("/api/auth/sign-in", baseUrl);
  // The key is deliberately nonexistent and unique per run. Output never
  // includes it; only status counts and latency are recorded.
  const email = `capacity-probe-${Date.now()}@invalid.openboard.events`;
  const burstStartedAt = performance.now();
  const samples = await Promise.all(Array.from({ length: REQUEST_COUNT }, async () => (
    sample(signInUrl, baseUrl.origin, email)
  )));
  const burstMs = Math.round(performance.now() - burstStartedAt);

  const statusCounts = new Map<number, number>();
  for (const result of samples) statusCounts.set(result.status, (statusCounts.get(result.status) ?? 0) + 1);
  const unexpected = samples.filter((result) => result.status !== 401 && result.status !== 429);
  if (unexpected.length > 0) {
    throw new Error(`credential burst returned unexpected statuses: ${unexpected.map((result) => result.status).join(",")}`);
  }

  // Budget the admissions the limiter is *designed* to allow over however long
  // the burst actually took, rather than assuming it drained inside one window.
  // The span is capped at the windows the latency budget itself permits, so a
  // pathologically slow edge fails the p95 gate below instead of quietly buying
  // itself enough windows to admit the whole burst.
  const maxWindows = Math.ceil(P95_LATENCY_BUDGET_MS / BURST_WINDOW_MS);
  const windowsSpanned = Math.min(maxWindows, Math.max(1, Math.ceil(burstMs / BURST_WINDOW_MS)));
  const admissionBudget = IP_BURST_LIMIT * windowsSpanned;
  const admitted = statusCounts.get(401) ?? 0;
  const limited = statusCounts.get(429) ?? 0;
  if (admitted > admissionBudget) {
    throw new Error(`credential burst admitted ${admitted}/${REQUEST_COUNT} over ${burstMs}ms (${windowsSpanned} window(s)); budget is ${admissionBudget}`);
  }

  const durations = samples.map((result) => result.durationMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
  const p95Ms = durations[p95Index] ?? 0;
  if (p95Ms > P95_LATENCY_BUDGET_MS) {
    throw new Error(`credential burst p95 ${p95Ms}ms exceeds ${P95_LATENCY_BUDGET_MS}ms budget`);
  }

  console.log(JSON.stringify({
    requests: REQUEST_COUNT,
    statuses: Object.fromEntries([...statusCounts.entries()].sort(([a], [b]) => a - b)),
    shed: limited,
    admitted,
    admissionBudget,
    burstMs,
    p95Ms,
    maxMs: durations.at(-1) ?? 0,
    budgetMs: P95_LATENCY_BUDGET_MS,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
