import { describe, expect, it } from "vitest";
import { ALL_SCOPES, OPTIONAL_SCOPES, REQUIRED_SCOPES, assumeUnreportedScopes, connectedAccountLabel, evaluateScopes, scopeGuidance } from "./scopes";

/**
 * `evaluateScopes` is the one function the connect dialog, the `blocked`-run
 * copy, and the scope checklist all read from — every subset of `ALL_SCOPES`
 * exercised here is a verdict that has to be right in all three places.
 */

function powerSet<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((sets, item) => sets.flatMap((set) => [set, [...set, item]]), [[]]);
}

describe("evaluateScopes — every subset of the five scopes", () => {
  const subsets = powerSet(ALL_SCOPES);

  it("can connect if and only if every required scope is present", () => {
    for (const subset of subsets) {
      const verdict = evaluateScopes(subset);
      const hasAllRequired = REQUIRED_SCOPES.every((scope) => subset.includes(scope));
      expect(verdict.canConnect, JSON.stringify(subset)).toBe(hasAllRequired);
    }
  });

  it("reports missingRequired as exactly REQUIRED_SCOPES minus what was granted", () => {
    for (const subset of subsets) {
      const verdict = evaluateScopes(subset);
      const expected = REQUIRED_SCOPES.filter((scope) => !subset.includes(scope));
      expect(verdict.missingRequired).toEqual(expected);
    }
  });

  it("reports missingOptional as exactly OPTIONAL_SCOPES minus what was granted", () => {
    for (const subset of subsets) {
      const verdict = evaluateScopes(subset);
      const expected = OPTIONAL_SCOPES.filter((scope) => !subset.includes(scope));
      expect(verdict.missingOptional).toEqual(expected);
    }
  });

  it("tracks canManageSchema on schema.bases:write alone, independent of the required set", () => {
    expect(evaluateScopes(["schema.bases:write"]).canManageSchema).toBe(true);
    expect(evaluateScopes([...REQUIRED_SCOPES]).canManageSchema).toBe(false);
    expect(evaluateScopes([...REQUIRED_SCOPES, "schema.bases:write"]).canManageSchema).toBe(true);
  });

  it("tracks canReadEmail on user.email:read alone", () => {
    expect(evaluateScopes(["user.email:read"]).canReadEmail).toBe(true);
    expect(evaluateScopes([]).canReadEmail).toBe(false);
  });

  it("checklist always lists all five scopes, required ones first, each marked granted or not", () => {
    for (const subset of subsets) {
      const verdict = evaluateScopes(subset);
      expect(verdict.checklist.map((entry) => entry.scope)).toEqual([...ALL_SCOPES]);
      expect(verdict.checklist.slice(0, REQUIRED_SCOPES.length).every((entry) => entry.required)).toBe(true);
      expect(verdict.checklist.slice(REQUIRED_SCOPES.length).every((entry) => !entry.required)).toBe(true);
      for (const entry of verdict.checklist) {
        expect(entry.granted).toBe(subset.includes(entry.scope));
      }
    }
  });

  it("ignores scopes Airtable might return that this product does not use", () => {
    const verdict = evaluateScopes(["data.records:read", "data.records:write", "schema.bases:read", "webhook:manage"]);
    expect(verdict.canConnect).toBe(true);
    expect(verdict.granted).not.toContain("webhook:manage");
  });
});

describe("assumeUnreportedScopes — the personal-access-token case", () => {
  /**
   * Airtable's `whoami` carries a `scopes` array for OAuth access tokens only.
   * A PAT — the one kind this product asks for — answers `{ id, email }`, so
   * "no list" has to mean *unknown*. Verified against the live API: a token
   * that successfully creates a base and writes records reports no scopes at
   * all. Reading that as `[]` refused every valid token.
   */
  it("assumes a token can connect and manage schema when Airtable reported nothing", () => {
    const verdict = evaluateScopes(assumeUnreportedScopes({ emailReturned: true }));
    expect(verdict.canConnect).toBe(true);
    expect(verdict.canManageSchema).toBe(true);
    expect(verdict.missingRequired).toEqual([]);
  });

  it("settles user.email:read on the one piece of evidence whoami does give", () => {
    expect(assumeUnreportedScopes({ emailReturned: true })).toContain("user.email:read");
    expect(assumeUnreportedScopes({ emailReturned: false })).not.toContain("user.email:read");
    expect(evaluateScopes(assumeUnreportedScopes({ emailReturned: false })).canConnect).toBe(true);
  });

  it("never invents a scope outside the five this product knows about", () => {
    for (const scope of assumeUnreportedScopes({ emailReturned: true })) {
      expect(ALL_SCOPES).toContain(scope);
    }
  });
});

describe("scopeGuidance", () => {
  it("gives every scope a capability title with no colon and a full-sentence reason", () => {
    for (const scope of ALL_SCOPES) {
      const guidance = scopeGuidance(scope);
      expect(guidance.scope).toBe(scope);
      expect(guidance.title).not.toMatch(/[:.]/u);
      expect(guidance.why.length).toBeGreaterThan(20);
      expect(guidance.why).toMatch(/[.!]$/u);
    }
  });

  it("marks exactly the three data/schema-read/write scopes as required", () => {
    expect(REQUIRED_SCOPES.every((scope) => scopeGuidance(scope).required)).toBe(true);
    expect(OPTIONAL_SCOPES.every((scope) => !scopeGuidance(scope).required)).toBe(true);
  });
});

describe("connectedAccountLabel", () => {
  it("prefers the email when granted", () => {
    expect(connectedAccountLabel("usrABCDEFGH1234", "priya@example.com")).toBe("priya@example.com");
  });

  it("elides the user id to its last four characters otherwise", () => {
    expect(connectedAccountLabel("usrABCDEFGH1234", null)).toBe("usr…1234");
  });

  it("never fabricates a display name Airtable never returned", () => {
    const label = connectedAccountLabel("usrABCDEFGH1234", null);
    expect(label).not.toMatch(/[A-Za-z]{2,}\s[A-Za-z]{2,}/u);
  });
});
