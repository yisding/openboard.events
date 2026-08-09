import { describe, expect, it } from "vitest";
import { OPENBOARD_NS, seedId, uuidv5 } from "../../scripts/seed/lib/ids";

/**
 * Determinism is the whole contract: it is what makes a re-run an upsert rather
 * than a duplicate, and what lets the demo script hard-code seeded URLs.
 */
describe("seedId", () => {
  it("is stable across calls and distinct across kinds and keys", () => {
    expect(seedId("event", "aie-nyc")).toBe(seedId("event", "aie-nyc"));
    expect(seedId("event", "aie-nyc")).not.toBe(seedId("event", "empty-conf"));
    expect(seedId("event", "aie-nyc")).not.toBe(seedId("form", "aie-nyc"));
  });

  it("produces a v5 uuid, which is what the uuid columns accept", () => {
    expect(seedId("contact", "speaker-1"))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("pins the namespace, because changing it orphans every seeded row", () => {
    expect(OPENBOARD_NS).toBe("4f1a5c2e-9b3d-5e7a-8c10-0d2f6b8a1e34");
  });
});

describe("uuidv5", () => {
  it("matches RFC 4122's published vector", () => {
    // DNS namespace, name "www.example.org". Pinning the spec's own vector is
    // what stops a hand-rolled SHA-1 derivation from drifting unnoticed.
    expect(uuidv5("www.example.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"))
      .toBe("74738ff5-5367-5958-9aee-98fffdcd1876");
  });

  it("refuses a namespace that is not a uuid", () => {
    expect(() => uuidv5("name", "not-a-uuid")).toThrow(/not a uuid/);
  });
});
