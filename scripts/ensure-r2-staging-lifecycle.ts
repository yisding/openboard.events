import { basename } from "node:path";

export const STAGING_LIFECYCLE_RULE_ID = "expire-staging";
export const STAGING_LIFECYCLE_PREFIX = "staging/";
export const STAGING_LIFECYCLE_MAX_AGE_SECONDS = 2 * 24 * 60 * 60;

export type LifecycleRule = {
  id: string;
  enabled: boolean;
  conditions: { prefix: string };
  deleteObjectsTransition?: { condition: { type: string; maxAge?: number; date?: string } };
  abortMultipartUploadsTransition?: unknown;
  storageClassTransitions?: unknown[];
};

export const STAGING_LIFECYCLE_RULE: LifecycleRule = {
  id: STAGING_LIFECYCLE_RULE_ID,
  enabled: true,
  conditions: { prefix: STAGING_LIFECYCLE_PREFIX },
  deleteObjectsTransition: {
    condition: { type: "Age", maxAge: STAGING_LIFECYCLE_MAX_AGE_SECONDS },
  },
};

export function isStagingLifecycleRule(rule: LifecycleRule): boolean {
  return rule.id === STAGING_LIFECYCLE_RULE_ID
    && rule.enabled === true
    && rule.conditions?.prefix === STAGING_LIFECYCLE_PREFIX
    && rule.deleteObjectsTransition?.condition.type === "Age"
    && rule.deleteObjectsTransition.condition.maxAge === STAGING_LIFECYCLE_MAX_AGE_SECONDS
    && rule.abortMultipartUploadsTransition === undefined
    && (rule.storageClassTransitions === undefined || rule.storageClassTransitions.length === 0);
}

/** Preserve unrelated bucket policy while making this repository's one rule exact. */
export function reconcileStagingLifecycleRules(existing: readonly LifecycleRule[]): {
  changed: boolean;
  rules: LifecycleRule[];
} {
  const matching = existing.filter((rule) => rule.id === STAGING_LIFECYCLE_RULE_ID);
  if (matching.length === 1 && matching[0] && isStagingLifecycleRule(matching[0])) {
    return { changed: false, rules: [...existing] };
  }
  return {
    changed: true,
    rules: [
      ...existing.filter((rule) => rule.id !== STAGING_LIFECYCLE_RULE_ID),
      STAGING_LIFECYCLE_RULE,
    ],
  };
}

type CloudflareEnvelope<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
};

async function cloudflareRequest<T>(
  accountId: string,
  apiToken: string,
  bucket: string,
  method: "GET" | "PUT",
  body?: unknown,
): Promise<T> {
  const url = new URL(
    `/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`,
    "https://api.cloudflare.com",
  );
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as CloudflareEnvelope<T> | null;
  if (!response.ok || !payload?.success) {
    const errors = payload?.errors?.map((error) => `${error.code ?? "unknown"}: ${error.message ?? "unknown"}`).join(", ");
    throw new Error(`Cloudflare lifecycle ${method} failed (${response.status})${errors ? `: ${errors}` : ""}`);
  }
  return payload.result;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target !== "preview" && target !== "production") {
    throw new Error("usage: ensure-r2-staging-lifecycle.ts preview|production");
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
  const bucket = target === "preview" ? "sb-files-preview" : "sb-files";

  const current = await cloudflareRequest<{ rules?: LifecycleRule[] }>(accountId, apiToken, bucket, "GET");
  const reconciled = reconcileStagingLifecycleRules(current.rules ?? []);
  if (reconciled.changed) {
    await cloudflareRequest(accountId, apiToken, bucket, "PUT", { rules: reconciled.rules });
  }

  const verified = await cloudflareRequest<{ rules?: LifecycleRule[] }>(accountId, apiToken, bucket, "GET");
  const matches = (verified.rules ?? []).filter((rule) => rule.id === STAGING_LIFECYCLE_RULE_ID);
  if (matches.length !== 1 || !matches[0] || !isStagingLifecycleRule(matches[0])) {
    throw new Error(`R2 lifecycle rule ${STAGING_LIFECYCLE_RULE_ID} did not verify on ${bucket}`);
  }
  console.log(JSON.stringify({
    bucket,
    changed: reconciled.changed,
    ruleId: STAGING_LIFECYCLE_RULE_ID,
    prefix: STAGING_LIFECYCLE_PREFIX,
    expireDays: STAGING_LIFECYCLE_MAX_AGE_SECONDS / (24 * 60 * 60),
    verified: true,
  }));
}

if (process.argv[1] && basename(process.argv[1]) === "ensure-r2-staging-lifecycle.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
