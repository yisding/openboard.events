import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { WEB_DEPLOY_SECRET_NAMES } from "../src/shared/lib/env";

type DeployService = "web" | "jobs";
type DeployEnvironment = "preview" | "production";

const JOBS_DEPLOY_SECRET_NAMES: readonly string[] = [];

/**
 * Secrets whose binding is gone from configuration but which survive in
 * Cloudflare's remote inventory until somebody deletes them by name:
 * `keep_vars: false` prunes plain vars, never encrypted secrets. A retired
 * credential nobody deletes is a credential nobody rotates, and it stays
 * readable to any future code that names it again by accident.
 *
 * This lived in `docs/provisioning.md` as an unchecked box for long enough to
 * become its own issue (#633). A deploy-time check is the version that cannot
 * be forgotten: the remedy is one command, and the preflight prints it.
 */
export const RETIRED_DEPLOY_SECRET_NAMES: readonly string[] = ["CRON_SECRET"];

export function requiredDeploySecrets(service: DeployService): readonly string[] {
  return service === "web" ? WEB_DEPLOY_SECRET_NAMES : JOBS_DEPLOY_SECRET_NAMES;
}

export function missingDeploySecrets(required: readonly string[], present: Iterable<string>): string[] {
  const names = new Set(present);
  return required.filter((name) => !names.has(name));
}

export function retiredDeploySecrets(present: Iterable<string>): string[] {
  const names = new Set(present);
  return RETIRED_DEPLOY_SECRET_NAMES.filter((name) => names.has(name));
}

export function retiredSecretDeleteCommand(service: DeployService, environment: DeployEnvironment, name: string): string {
  const config = service === "jobs" ? " --config workers/jobs/wrangler.jsonc" : "";
  return `pnpm exec wrangler secret delete ${name}${config} --env ${environment}`;
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

  // Listed unconditionally now, including for jobs (which requires none of its
  // own): the inventory is checked for what should *not* be there as well as
  // for what must.
  const present = secretNames(service, environment);
  const missing = missingDeploySecrets(requiredDeploySecrets(service), present);
  if (missing.length > 0) {
    throw new Error(`${service}/${environment} is missing required Cloudflare secret bindings: ${missing.join(", ")}`);
  }
  const retired = retiredDeploySecrets(present);
  if (retired.length > 0) {
    const commands = retired.map((name) => `  ${retiredSecretDeleteCommand(service, environment, name)}`).join("\n");
    throw new Error(
      `${service}/${environment} still holds retired Cloudflare secrets: ${retired.join(", ")}\n`
      + `Their bindings are gone from configuration, but an encrypted secret persists until it is deleted by name. Delete them, then redeploy:\n${commands}`,
    );
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
