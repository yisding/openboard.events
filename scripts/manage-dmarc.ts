import { basename } from "node:path";

export const DMARC_ZONE_NAME = "openboard.events";
export const DMARC_FROM_DOMAIN = "mail.openboard.events";
export const CLOUDFLARE_RUA_DOMAIN = "dmarc-reports.cloudflare.net";

type CloudflareError = { code?: number; message?: string };

type CloudflareEnvelope<T> = {
  success: boolean;
  result?: T;
  errors?: CloudflareError[];
};

type DnsRecord = {
  id?: string;
  name?: string;
  content?: string;
  ttl?: number;
  type?: string;
};

export type ApprovedDmarcSource = {
  domain?: string;
  ips?: string[];
  name?: string;
};

export type CloudflareDmarcStatus = {
  approved_sources?: ApprovedDmarcSource[];
  enabled?: boolean;
  records?: { dmarc_records?: DnsRecord[] };
  rua_prefix?: string;
  status?: "missing-dmarc-report" | "multiple-dmarc-reports" | "missing-dmarc-rua" | "cname-on-dmarc-record";
  zone_id?: string;
};

export type DmarcPolicy = {
  version: string;
  policy: string | undefined;
  subdomainPolicy: string | undefined;
  percentage: number | undefined;
  aggregateReportUris: string[];
  tags: Record<string, string>;
};

export function parseDmarcPolicy(content: string): DmarcPolicy {
  const tags = Object.fromEntries(content
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) throw new Error(`invalid DMARC tag: ${part}`);
      return [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
    }));
  if (tags.v?.toUpperCase() !== "DMARC1") throw new Error("DMARC record must declare v=DMARC1");
  if (tags.pct !== undefined && !/^\d{1,3}$/u.test(tags.pct)) {
    throw new Error("DMARC pct must be an integer from 0 to 100");
  }
  const percentage = tags.pct === undefined ? undefined : Number.parseInt(tags.pct, 10);
  if (percentage !== undefined && percentage > 100) {
    throw new Error("DMARC pct must be an integer from 0 to 100");
  }
  return {
    version: "DMARC1",
    policy: tags.p?.toLowerCase(),
    subdomainPolicy: tags.sp?.toLowerCase(),
    percentage,
    aggregateReportUris: tags.rua?.split(",").map((uri) => uri.trim()).filter(Boolean) ?? [],
    tags,
  };
}

export function cloudflareRua(prefix: string): string {
  if (!/^[a-f0-9]{32}$/u.test(prefix)) throw new Error("Cloudflare DMARC RUA prefix must be 32 lowercase hex characters");
  return `mailto:${prefix}@${CLOUDFLARE_RUA_DOMAIN}`;
}

export function apexDmarcRecord(status: CloudflareDmarcStatus): DnsRecord & { content: string } {
  const records = (status.records?.dmarc_records ?? []).filter((record) =>
    record.type === "TXT" && record.name?.toLowerCase() === `_dmarc.${DMARC_ZONE_NAME}`,
  );
  const [record] = records;
  if (records.length !== 1 || !record?.content) {
    throw new Error(`expected exactly one TXT record at _dmarc.${DMARC_ZONE_NAME}`);
  }
  return { ...record, content: record.content };
}

export function summarizeDmarcStatus(status: CloudflareDmarcStatus): {
  enabled: boolean;
  reportingConfigured: boolean;
  awaitingFirstReport: boolean;
  policy: DmarcPolicy;
  approvedSources: ApprovedDmarcSource[];
  record: string;
} {
  const record = apexDmarcRecord(status);
  const policy = parseDmarcPolicy(record.content);
  const rua = status.rua_prefix ? cloudflareRua(status.rua_prefix) : undefined;
  const reportingConfigured = status.enabled === true
    && rua !== undefined
    && policy.aggregateReportUris.some((uri) => uri.toLowerCase() === rua);
  return {
    enabled: status.enabled === true,
    reportingConfigured,
    awaitingFirstReport: status.status === "missing-dmarc-report",
    policy,
    approvedSources: status.approved_sources ?? [],
    record: record.content,
  };
}

async function cloudflareRequest<T>(
  apiToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(new URL(`/client/v4/${path}`, "https://api.cloudflare.com"), {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as CloudflareEnvelope<T> | null;
  if (!response.ok || !payload?.success || payload.result === undefined) {
    const errors = payload?.errors?.map((error) => `${error.code ?? "unknown"}: ${error.message ?? "unknown"}`).join(", ");
    throw new Error(`Cloudflare API request failed (${response.status})${errors ? `: ${errors}` : ""}`);
  }
  return payload.result;
}

export function validateZoneId(zoneId: string | undefined): string {
  if (!zoneId || !/^[a-f0-9]{32}$/u.test(zoneId)) {
    throw new Error("CLOUDFLARE_ZONE_ID must be a 32-character lowercase hexadecimal zone ID");
  }
  return zoneId;
}

async function readStatus(apiToken: string, zoneId: string): Promise<CloudflareDmarcStatus> {
  return cloudflareRequest(apiToken, `zones/${encodeURIComponent(zoneId)}/email/auth/dmarc-reports`);
}

function printableSummary(operation: string, changed: boolean, status: CloudflareDmarcStatus) {
  const summary = summarizeDmarcStatus(status);
  return {
    operation,
    changed,
    zone: DMARC_ZONE_NAME,
    fromDomain: DMARC_FROM_DOMAIN,
    enabled: summary.enabled,
    reportingConfigured: summary.reportingConfigured,
    awaitingFirstReport: summary.awaitingFirstReport,
    policy: summary.policy.policy ?? null,
    subdomainPolicy: summary.policy.subdomainPolicy ?? null,
    percentage: summary.policy.percentage ?? 100,
    aggregateReportUris: summary.policy.aggregateReportUris,
    approvedSources: summary.approvedSources.map((source) => ({
      name: source.name ?? null,
      domain: source.domain ?? null,
      ips: source.ips ?? [],
    })),
    record: summary.record,
  };
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation !== "status" && operation !== "enable-reporting") {
    throw new Error("usage: manage-dmarc.ts status|enable-reporting");
  }
  const apiToken = process.env.CLOUDFLARE_DMARC_API_TOKEN;
  if (!apiToken) throw new Error("CLOUDFLARE_DMARC_API_TOKEN is required");
  const zoneId = validateZoneId(process.env.CLOUDFLARE_ZONE_ID);
  let status = await readStatus(apiToken, zoneId);
  let changed = false;

  if (operation === "enable-reporting") {
    let configured = false;
    try {
      configured = summarizeDmarcStatus(status).reportingConfigured;
    } catch {
      // Enabling Cloudflare reporting repairs a missing record or RUA target.
    }
    if (!configured) {
      await cloudflareRequest(apiToken, `zones/${encodeURIComponent(zoneId)}/email/auth/dmarc-reports`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      });
      changed = true;
      status = await readStatus(apiToken, zoneId);
    }
    if (!summarizeDmarcStatus(status).reportingConfigured) {
      throw new Error("Cloudflare DMARC reporting did not verify after enablement");
    }
  }

  console.log(JSON.stringify(printableSummary(operation, changed, status)));
}

if (process.argv[1] && basename(process.argv[1]) === "manage-dmarc.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
