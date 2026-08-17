import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AIRTABLE_COPY,
  ALL_SCOPES,
  REQUIRED_SCOPES,
  SYNC_TABLE_ORDER,
  airtableBaseUrl,
  airtableConnectionSummarySchema,
  airtablePatSchema,
  airtableTokenResultSchema,
  connectedAccountLabel,
  describeDuration,
  emptySyncRunStats,
  evaluateScopes,
  scopeGuidance,
  tileCounts,
} from "./index.schemas";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const summary = {
  id: "6f1f0e2a-1f7e-4a2f-9f1e-2c3d4e5f6a7b",
  status: "connected",
  airtableUserId: "usrABCD1234EF5678",
  accountEmail: null,
  tokenHint: "7f2c",
  scopes: [...REQUIRED_SCOPES],
  baseId: "appABCD12345678",
  baseName: "SH-5 2026 Program",
  syncEnabled: true,
  options: { includeEmail: true, includeBio: true, includePronouns: false, includeGender: false, includeHeadshots: true, pruneRemoved: false },
  schemaReady: true,
  nextSyncAfter: "2026-08-15T12:00:00.000Z",
  lastSyncedAt: "2026-08-15T11:45:00.000Z",
  lastErrorKey: null,
  consecutiveFailures: 0,
  createdAt: "2026-08-01T09:00:00.000Z",
};

describe("the connect flow's wire contract", () => {
  /**
   * The one property this whole feature is built around: there is no shape for
   * a personal access token to travel back to a browser in. Asserted on the
   * schema rather than on a handler, because a schema covers every present and
   * future caller of it.
   */
  it("has no field a personal access token could ride back to the browser in", () => {
    const keys = Object.keys(airtableConnectionSummarySchema.shape);
    for (const forbidden of ["token", "pat", "tokenCiphertext", "ciphertext", "tokenFingerprint", "fingerprint", "secret"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys).toContain("tokenHint");

    // And an over-eager server spread cannot smuggle one through: zod strips
    // what the shape does not name.
    const parsed = airtableConnectionSummarySchema.parse({ ...summary, token: "patSECRETSECRETSECRET" });
    expect(JSON.stringify(parsed)).not.toContain("patSECRET");

    const verdict = airtableTokenResultSchema.parse({
      connection: summary,
      verdict: {
        airtableUserId: "usrABCD1234EF5678",
        accountEmail: null,
        scopes: [...REQUIRED_SCOPES],
        canConnect: true,
        canManageSchema: false,
        missingRequired: [],
        missingOptional: ["schema.bases:write", "user.email:read"],
      },
      token: "patSECRETSECRETSECRET",
    });
    expect(JSON.stringify(verdict)).not.toContain("patSECRET");
  });

  it("keeps the plaintext-token reader out of the feature's public barrel", () => {
    // Comments stripped: the barrel documents *why* the function is absent,
    // and that sentence is not an export.
    const barrel = read("./index.ts").replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(barrel).not.toContain("openAirtableConnectionIn");
    for (const route of [
      "../../app/api/internal/events/[eventId]/airtable/route.ts",
      "../../app/api/internal/events/[eventId]/airtable/token/route.ts",
      "../../app/api/internal/events/[eventId]/airtable/bases/route.ts",
      "../../app/api/internal/events/[eventId]/airtable/sync/route.ts",
    ]) {
      expect(read(route), route).not.toContain("openAirtableConnection");
    }
  });

  it("accepts a realistic token and rejects the shapes people paste by mistake", () => {
    expect(airtablePatSchema.safeParse(`pat${"a".repeat(14)}.${"b".repeat(64)}`).success).toBe(true);
    expect(airtablePatSchema.safeParse("keyABCDEFGHIJKLMNO").success).toBe(false);
    expect(airtablePatSchema.safeParse("pat").success).toBe(false);
    // A pasted token carrying stray whitespace is trimmed, not refused.
    expect(airtablePatSchema.safeParse(`  pat${"a".repeat(14)}.${"b".repeat(64)}  `).success).toBe(true);
  });
});

describe("scope guidance", () => {
  it("gives every scope a capability name and a reason, never the raw identifier", () => {
    for (const scope of ALL_SCOPES) {
      const guidance = scopeGuidance(scope);
      expect(guidance.title).not.toContain(":");
      expect(guidance.why.length).toBeGreaterThan(20);
      expect(guidance.why).toMatch(/[.!]$/u);
    }
  });

  it("blocks connecting on a missing required scope and not on a missing optional one", () => {
    expect(evaluateScopes([...REQUIRED_SCOPES]).canConnect).toBe(true);
    expect(evaluateScopes(["data.records:read", "schema.bases:read"]).canConnect).toBe(false);
    expect(evaluateScopes(["data.records:read", "schema.bases:read"]).missingRequired).toEqual(["data.records:write"]);
    expect(evaluateScopes([...REQUIRED_SCOPES]).canManageSchema).toBe(false);
  });

  it("degrades the connected-as line to an elided user id when the email scope is absent", () => {
    expect(connectedAccountLabel("usrABCD1234EF7f2c", null)).toBe("usr…7f2c");
    expect(connectedAccountLabel("usrABCD1234EF7f2c", "priya@example.com")).toBe("priya@example.com");
  });
});

describe("status card arithmetic", () => {
  it("groups the four lookup tables into one tile and leaves the three headline tables alone", () => {
    const stats = {
      ...emptySyncRunStats(),
      perTable: SYNC_TABLE_ORDER.map((key) => ({
        key, created: 1, updated: 1, unchanged: 1, deleted: 0, orphans: 0, purgeHeld: 0, deferred: 0,
      })),
    };
    const tiles = tileCounts(stats);
    expect(tiles.sessions).toBe(3);
    expect(tiles.people).toBe(3);
    expect(tiles.proposals).toBe(3);
    expect(tiles.lookups).toBe(12);
  });

  it("phrases durations without ever reaching for the viewer's locale", () => {
    expect(describeDuration(5_000)).toBe("a moment");
    expect(describeDuration(240_000)).toBe("4 minutes");
    expect(describeDuration(660_000)).toBe("11 minutes");
    expect(describeDuration(7_200_000)).toBe("about 2 hours");
    expect(describeDuration(259_200_000)).toBe("3 days");
    expect(describeDuration(-1)).toBe("a moment");
  });

  it("deep-links to the customer's own base", () => {
    expect(airtableBaseUrl("appABCD12345678")).toBe("https://airtable.com/appABCD12345678");
  });
});

describe("the copy an organizer actually reads", () => {
  it("names what is pushed, what is not, and that it only goes one way", () => {
    const { disclosure } = AIRTABLE_COPY;
    expect(disclosure.pushedTables).toContain("Proposals");
    expect(disclosure.notPushedBody).toContain("unsubscribe state");
    expect(disclosure.oneWayBody).toContain("ever overwritten by us on an unchanged row");
    expect(disclosure.oneWayBody).toContain("ever read back");
  });

  it("promises the same token can be topped up rather than retyped", () => {
    expect(AIRTABLE_COPY.token.scopesFooter).toContain("you don’t need to make a new one");
  });
});
