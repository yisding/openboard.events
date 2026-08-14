import { describe, expect, it } from "vitest";
import {
  apexDmarcRecord,
  cloudflareRua,
  parseDmarcPolicy,
  summarizeDmarcStatus,
  validateZoneId,
} from "../scripts/manage-dmarc";

const prefix = "0123456789abcdef0123456789abcdef";
const rua = cloudflareRua(prefix);

describe("DMARC operations", () => {
  it("parses case-insensitive tags, multiple report targets, and staged policy", () => {
    expect(parseDmarcPolicy(`v=DMARC1; p=Quarantine; pct=10; rua=mailto:ops@example.com,${rua};`)).toMatchObject({
      version: "DMARC1",
      policy: "quarantine",
      percentage: 10,
      aggregateReportUris: ["mailto:ops@example.com", rua],
    });
  });

  it("rejects malformed records and percentages", () => {
    expect(() => parseDmarcPolicy("p=none")).toThrow("v=DMARC1");
    expect(() => parseDmarcPolicy("v=DMARC1; p=none; pct=101")).toThrow("0 to 100");
    expect(() => parseDmarcPolicy("v=DMARC1; p=none; pct=10percent")).toThrow("0 to 100");
    expect(() => parseDmarcPolicy("v=DMARC1; broken")).toThrow("invalid DMARC tag");
    expect(() => cloudflareRua("not-a-prefix")).toThrow("32 lowercase hex");
  });

  it("requires exactly one apex DMARC record", () => {
    expect(() => apexDmarcRecord({ records: { dmarc_records: [] } })).toThrow("exactly one TXT");
    expect(() => apexDmarcRecord({
      records: { dmarc_records: [
        { type: "TXT", name: "_dmarc.openboard.events", content: "v=DMARC1; p=none" },
        { type: "TXT", name: "_dmarc.openboard.events", content: "v=DMARC1; p=reject" },
      ] },
    })).toThrow("exactly one TXT");
  });

  it("distinguishes configured reporting from the first-report wait", () => {
    expect(summarizeDmarcStatus({
      enabled: true,
      rua_prefix: prefix,
      status: "missing-dmarc-report",
      approved_sources: [{ name: "Amazon SES", domain: "amazonses.com", ips: ["192.0.2.1"] }],
      records: { dmarc_records: [{
        type: "TXT",
        name: "_dmarc.openboard.events",
        content: `v=DMARC1; p=none; rua=${rua}`,
      }] },
    })).toMatchObject({
      enabled: true,
      reportingConfigured: true,
      awaitingFirstReport: true,
      approvedSources: [{ name: "Amazon SES" }],
    });
  });

  it("does not accept enabled reporting without the exact Cloudflare RUA", () => {
    expect(summarizeDmarcStatus({
      enabled: true,
      rua_prefix: prefix,
      records: { dmarc_records: [{
        type: "TXT",
        name: "_dmarc.openboard.events",
        content: "v=DMARC1; p=none; rua=mailto:elsewhere@example.com",
      }] },
    }).reportingConfigured).toBe(false);
  });

  it("requires an explicit Cloudflare zone ID without granting Zone Read", () => {
    const zoneId = "0123456789abcdef0123456789abcdef";
    expect(validateZoneId(zoneId)).toBe(zoneId);
    expect(() => validateZoneId(undefined)).toThrow("CLOUDFLARE_ZONE_ID");
    expect(() => validateZoneId("openboard.events")).toThrow("32-character");
  });
});
