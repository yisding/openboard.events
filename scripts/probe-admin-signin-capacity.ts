const REQUEST_COUNT = 12;
const REQUEST_TIMEOUT_MS = 10_000;
const P95_LATENCY_BUDGET_MS = 5_000;

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
  const samples = await Promise.all(Array.from({ length: REQUEST_COUNT }, async () => (
    sample(signInUrl, baseUrl.origin, email)
  )));

  const statusCounts = new Map<number, number>();
  for (const result of samples) statusCounts.set(result.status, (statusCounts.get(result.status) ?? 0) + 1);
  const unexpected = samples.filter((result) => result.status !== 401 && result.status !== 429);
  if (unexpected.length > 0) {
    throw new Error(`credential burst returned unexpected statuses: ${unexpected.map((result) => result.status).join(",")}`);
  }

  const limited = statusCounts.get(429) ?? 0;
  if (limited < REQUEST_COUNT - 1) {
    throw new Error(`credential burst shed ${limited}/${REQUEST_COUNT}; expected at least ${REQUEST_COUNT - 1} controlled 429 responses`);
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
    p95Ms,
    maxMs: durations.at(-1) ?? 0,
    budgetMs: P95_LATENCY_BUDGET_MS,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
