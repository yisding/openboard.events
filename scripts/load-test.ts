import { readFileSync } from "node:fs";

/**
 * M10 step 9 — the CP2 load test, and the verification half of risk #2.
 *
 *   pnpm exec tsx scripts/load-test.ts https://<preview> --form <formId> --slug <eventSlug>
 *
 * Fires N concurrent submits at the deployed preview, each from its own portal
 * session with its own email. What it proves is not throughput: it is that the
 * Neon WebSocket Pool's per-request lifecycle survives a burst (the
 * deadline-minute scenario) and that `createSubmission`'s `FOR UPDATE` event-row
 * lock does not deadlock under contention.
 *
 * Every response must be a 200 or a *typed* LIMIT_REACHED / FORM_CLOSED /
 * FORM_VERSION_STALE. A single 5xx fails the run — that is the signal that
 * triggers the pre-decided CTE rewrite of the eight audited withTx paths, and
 * its trigger date is Sunday night, not Wednesday.
 */

type Args = { baseUrl: string; formId: string; slug: string; concurrency: number; payloadFile?: string };

function parseArgs(argv: string[]): Args {
  const [baseUrl, ...rest] = argv;
  if (!baseUrl) throw new Error("usage: tsx scripts/load-test.ts <baseUrl> --form <formId> --slug <eventSlug> [--concurrency 50] [--payload file.json]");
  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const formId = flag("form");
  const slug = flag("slug");
  if (!formId || !slug) throw new Error("--form <formId> and --slug <eventSlug> are required");
  const payloadFile = flag("payload");
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    formId,
    slug,
    concurrency: Number(flag("concurrency") ?? 50),
    ...(payloadFile ? { payloadFile } : {}),
  };
}

type Json = Record<string, unknown>;

async function postJson(url: string, body: Json, cookie?: string): Promise<{ status: number; json: Json; setCookie: string | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Json = {};
  try {
    json = text ? JSON.parse(text) as Json : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: response.status, json, setCookie: response.headers.get("set-cookie") };
}

/**
 * The real judge path: request a code, read it from the preview-only fallback,
 * verify, and keep the session cookie. Production never renders that code, so
 * this script is a preview instrument by construction.
 */
async function mintSession(args: Args, email: string): Promise<string> {
  const requested = await postJson(`${args.baseUrl}/api/internal/auth/portal/request`, { eventSlug: args.slug, email });
  const data = requested.json.data as { fallback?: { otp?: string } } | undefined;
  const otp = data?.fallback?.otp;
  if (!otp) {
    const failure = requested.json.error as { code?: string; message?: string } | undefined;
    // Distinguish the two ways this goes wrong: the event is not seeded on the
    // target, or the target does not render the fallback code (production).
    if (failure) throw new Error(`${failure.code ?? requested.status}: ${failure.message ?? "request rejected"}`);
    // No envelope at all means the route is not on the deployed revision.
    if (typeof requested.json.raw === "string") throw new Error(`the portal request route returned no JSON (status ${requested.status}) — is this revision deployed?`);
    throw new Error(`no fallback code (status ${requested.status}) — EMAIL_FALLBACK_UI must be 1 on the target`);
  }
  const verified = await postJson(`${args.baseUrl}/api/internal/auth/portal/verify`, { eventSlug: args.slug, email, code: otp });
  const cookie = verified.setCookie?.split(";")[0];
  if (!cookie) throw new Error(`verify returned no session cookie for ${email} (status ${verified.status})`);
  return cookie;
}

/** The draft row the wizard creates at the Account step, pinned to a version. */
async function openDraft(args: Args, cookie: string): Promise<{ submissionId: string; formVersion: number }> {
  const created = await postJson(`${args.baseUrl}/api/internal/forms/${args.formId}/draft`, {}, cookie);
  const data = created.json.data as { submissionId?: string; formVersion?: number } | undefined;
  if (!data?.submissionId || typeof data.formVersion !== "number") {
    throw new Error(`draft failed (status ${created.status}): ${JSON.stringify(created.json).slice(0, 200)}`);
  }
  return { submissionId: data.submissionId, formVersion: data.formVersion };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const payload = args.payloadFile ? JSON.parse(readFileSync(args.payloadFile, "utf8")) as Json : { answers: {}, participants: [] };
  const runId = Date.now().toString(36);
  const emails = Array.from({ length: args.concurrency }, (_, index) => `load+${runId}-${index}@openboard.dev`);

  console.log(`minting ${emails.length} portal sessions against ${args.baseUrl}`);
  const sessions: Array<{ email: string; cookie: string; draft: { submissionId: string; formVersion: number } }> = [];
  for (const email of emails) {
    try {
      const cookie = await mintSession(args, email);
      sessions.push({ email, cookie, draft: await openDraft(args, cookie) });
    } catch (error) {
      console.error(`  ${email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (sessions.length === 0) throw new Error("no sessions were minted; nothing to load test");
  console.log(`minted ${sessions.length}/${emails.length}`);

  // The burst itself: every submit leaves at the same moment, which is the whole
  // point — a sequential run would never contend for the event row lock.
  console.log(`firing ${sessions.length} concurrent submits`);
  const started = Date.now();
  const results = await Promise.all(sessions.map(async (session) => {
    const at = Date.now();
    const response = await postJson(`${args.baseUrl}/api/internal/forms/${args.formId}/submit`, {
      ...payload,
      formVersion: session.draft.formVersion,
      draftSubmissionId: session.draft.submissionId,
    }, session.cookie);
    const code = (response.json.error as { code?: string } | undefined)?.code;
    return { ms: Date.now() - at, status: response.status, ...(code ? { code } : {}) };
  }));
  const wallClock = Date.now() - started;

  const latencies = results.map((result) => result.ms).sort((a, b) => a - b);
  const byOutcome = new Map<string, number>();
  for (const result of results) {
    const key = result.status === 200 ? "200 ok" : `${result.status} ${result.code ?? "untyped"}`;
    byOutcome.set(key, (byOutcome.get(key) ?? 0) + 1);
  }

  console.log("");
  console.log(`wall clock  ${wallClock} ms for ${results.length} submits`);
  console.log(`p50 ${percentile(latencies, 0.5)} ms · p95 ${percentile(latencies, 0.95)} ms · p99 ${percentile(latencies, 0.99)} ms`);
  console.log("outcomes:");
  for (const [outcome, count] of [...byOutcome].sort()) console.log(`  ${outcome.padEnd(28)} ${count}`);

  // A typed rejection is a pass: the limit and the closed form are real answers.
  // A 5xx is not, and neither is an error the client cannot act on.
  const untyped = results.filter((result) => result.status >= 500 || (result.status !== 200 && !result.code));
  console.log("");
  if (untyped.length > 0) {
    console.log(`FAILED — ${untyped.length} response(s) were 5xx or untyped; record this and consider the CTE fallback`);
    process.exitCode = 1;
    return;
  }
  console.log(`passed — record p95 ${percentile(latencies, 0.95)} ms in DECISIONS.md`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
