import { basename } from "node:path";

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
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/script-settings`,
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
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required to prove first bootstrap");
  }
  await assertWebWorkerAbsent(environment, accountId, apiToken);
  console.log(`confirmed ${webWorkerName(environment)} does not exist; first-bootstrap bypass allowed`);
}

if (process.argv[1] && basename(process.argv[1]) === "check-worker-bootstrap.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
