import { describe, expect, it } from "vitest";
import { assertSafeSeedTarget, decideSeedTarget } from "../../scripts/seed/lib/safety";

/**
 * The claim (`APP_ENV`) and the fact (what the database says about itself) are
 * different things. Checking only the claim is what lets `APP_ENV=local` with a
 * production `DATABASE_URL` truncate production.
 */
describe("decideSeedTarget", () => {
  it("refuses a database that identifies itself as production", () => {
    const verdict = decideSeedTarget({ claimed: "production", actual: "production", allowProd: false });
    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty("reason", expect.stringContaining("SEED_ALLOW_PROD=1"));
  });

  it("allows production only with the deliberate capability", () => {
    expect(decideSeedTarget({ claimed: "production", actual: "production", allowProd: true }).ok).toBe(true);
  });

  it("refuses when the operator's claim and the database disagree", () => {
    // The reported hole: APP_ENV=local aimed at a production DATABASE_URL.
    const verdict = decideSeedTarget({ claimed: "local", actual: "production", allowProd: false });
    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty("reason", expect.stringContaining("identifies itself as production"));
  });

  it("refuses a mismatch in either direction rather than guessing", () => {
    const verdict = decideSeedTarget({ claimed: "preview", actual: "local", allowProd: false });
    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty("reason", expect.stringContaining("refusing rather than guessing"));
  });

  it("proceeds with a warning when nobody has marked the database", () => {
    const verdict = decideSeedTarget({ claimed: "local", actual: null, allowProd: false });
    expect(verdict.ok).toBe(true);
    expect(verdict).toHaveProperty("warning", expect.stringContaining("ALTER DATABASE"));
  });

  it("agrees with itself on a matching non-production target", () => {
    expect(decideSeedTarget({ claimed: "preview", actual: "preview", allowProd: false })).toEqual({ ok: true });
  });
});

describe("assertSafeSeedTarget", () => {
  it("refuses an unclassified target", () => {
    expect(() => assertSafeSeedTarget({})).toThrow(/unclassified/);
    expect(() => assertSafeSeedTarget({ APP_ENV: "staging" })).toThrow(/unclassified/);
  });

  it("refuses production without the capability and allows it with", () => {
    expect(() => assertSafeSeedTarget({ APP_ENV: "production" })).toThrow(/SEED_ALLOW_PROD=1/);
    expect(() => assertSafeSeedTarget({ APP_ENV: "production", SEED_ALLOW_PROD: "1" })).not.toThrow();
  });

  it("passes a classified non-production target", () => {
    expect(() => assertSafeSeedTarget({ APP_ENV: "local" })).not.toThrow();
  });
});
