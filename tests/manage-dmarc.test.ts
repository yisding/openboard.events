import { describe, expect, it, vi } from "vitest";
import {
  apexDmarcRecord,
  cloudflareRua,
  parseDmarcPolicy,
  publicDmarcRecord,
  readPublicFromDomainPolicy,
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

  it("reads one exact DMARC TXT answer from DNS JSON", () => {
    expect(publicDmarcRecord({
      Status: 0,
      Answer: [{
        name: "_dmarc.mail.openboard.events.",
        type: 16,
        data: '"v=DMARC1; p=quarantine; " "pct=100"',
      }],
    }, "_dmarc.mail.openboard.events")).toBe("v=DMARC1; p=quarantine; pct=100");
  });

  it("fails closed when public DNS has no unique exact-name DMARC answer", () => {
    expect(() => publicDmarcRecord({ Status: 3 }, "_dmarc.mail.openboard.events"))
      .toThrow("returned status 3");
    expect(() => publicDmarcRecord({
      Status: 0,
      Answer: [
        { name: "_dmarc.mail.openboard.events.", type: 16, data: '"v=DMARC1; p=none"' },
        { name: "_dmarc.mail.openboard.events.", type: 16, data: '"v=DMARC1; p=reject"' },
      ],
    }, "_dmarc.mail.openboard.events")).toThrow("exactly one public TXT");
  });

  it("requires Cloudflare and Google public DNS to agree on the From-domain policy", async () => {
    const answer = (policy: string) => new Response(JSON.stringify({
      Status: 0,
      Answer: [{
        name: "_dmarc.mail.openboard.events.",
        type: 16,
        data: `"v=DMARC1; p=${policy}; pct=100"`,
      }],
    }), { status: 200 });
    const agreeing = vi.fn(async () => answer("quarantine")) as unknown as typeof fetch;
    await expect(readPublicFromDomainPolicy(agreeing)).resolves.toMatchObject({
      policy: { policy: "quarantine", percentage: 100 },
      resolvers: ["cloudflare", "google"],
    });

    const disagreeing = vi.fn(async (input: string | URL | Request) =>
      answer(new URL(input instanceof Request ? input.url : input).hostname === "dns.google" ? "reject" : "quarantine")) as unknown as typeof fetch;
    await expect(readPublicFromDomainPolicy(disagreeing)).rejects.toThrow("public resolvers disagree");
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
