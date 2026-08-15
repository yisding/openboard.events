import { basename } from "node:path";
import { cloudflareApiUrl, requireCloudflareCredentials } from "./lib/cloudflare";

type DeployEnvironment = "preview" | "production";
type Fetcher = typeof fetch;

export function webWorkerName(environment: DeployEnvironment): string {
  return environment === "preview" ? "sb-web-preview" : "sb-web";
}

/** Fail closed unless Cloudflare proves the target web Worker is absent. */
export async function assertWebWorkerAbsent(
  environment: DeployEnvironment,
  accountId: string,
  apiToken: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const worker = webWorkerName(environment);
  // Raw status, not `cloudflareRequest`: a 404 is the success case here, and
  // unwrapping the envelope would throw on precisely the response this needs.
  const response = await fetcher(
    cloudflareApiUrl(`accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/script-settings`).toString(),
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (response.status === 404) return;
  if (response.ok) throw new Error(`refusing secret-inventory bypass: Cloudflare Worker ${worker} already exists`);
  throw new Error(`could not prove Cloudflare Worker ${worker} is absent (HTTP ${response.status})`);
}

async function main(): Promise<void> {
  const environment = process.argv[2];
  if (environment !== "preview" && environment !== "production") {
    throw new Error("usage: check-worker-bootstrap.ts preview|production");
  }
  const { accountId, apiToken } = requireCloudflareCredentials("to prove first bootstrap");
  await assertWebWorkerAbsent(environment, accountId, apiToken);
  console.log(`confirmed ${webWorkerName(environment)} does not exist; first-bootstrap bypass allowed`);
}

if (process.argv[1] && basename(process.argv[1]) === "check-worker-bootstrap.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
