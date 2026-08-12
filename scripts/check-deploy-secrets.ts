import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { WEB_DEPLOY_SECRET_NAMES } from "../src/shared/lib/env";

type DeployService = "web" | "jobs";
type DeployEnvironment = "preview" | "production";

const JOBS_DEPLOY_SECRET_NAMES = ["CRON_SECRET"] as const;

export function requiredDeploySecrets(service: DeployService): readonly string[] {
  return service === "web" ? WEB_DEPLOY_SECRET_NAMES : JOBS_DEPLOY_SECRET_NAMES;
}

export function missingDeploySecrets(required: readonly string[], present: Iterable<string>): string[] {
  const names = new Set(present);
  return required.filter((name) => !names.has(name));
}

function secretNames(service: DeployService, environment: DeployEnvironment): string[] {
  const args = ["exec", "wrangler", "secret", "list"];
  if (service === "jobs") args.push("--config", "workers/jobs/wrangler.jsonc");
  args.push("--env", environment);

  const result = spawnSync("pnpm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) process.exit(result.status ?? 1);

  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error("wrangler secret list did not return JSON");
  }
  if (!Array.isArray(payload) || payload.some((row) => typeof row !== "object" || row === null || typeof (row as { name?: unknown }).name !== "string")) {
    throw new Error("wrangler secret list returned an unexpected shape");
  }
  return payload.map((row) => (row as { name: string }).name);
}

function main(): void {
  const service = process.argv[2];
  const environment = process.argv[3];
  if (service !== "web" && service !== "jobs") {
    throw new Error("usage: check-deploy-secrets.ts web|jobs preview|production");
  }
  if (environment !== "preview" && environment !== "production") {
    throw new Error("usage: check-deploy-secrets.ts web|jobs preview|production");
  }

  const missing = missingDeploySecrets(requiredDeploySecrets(service), secretNames(service, environment));
  if (missing.length > 0) {
    throw new Error(`${service}/${environment} is missing required Cloudflare secret bindings: ${missing.join(", ")}`);
  }
  console.log(`deploy secret preflight passed for ${service}/${environment}`);
}

if (process.argv[1] && basename(process.argv[1]) === "check-deploy-secrets.ts") {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
