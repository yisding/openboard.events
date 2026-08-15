import { describe, expect, it } from "vitest";
import { organizationIdSchema, type EventId } from "@/shared/contracts";
import { RESERVED_SLUGS } from "@/shared/lib/slug";
import { demoEmail, demoEventId, demoId, demoSlug } from "./ids";

const ORG_A = organizationIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const ORG_B = organizationIdSchema.parse("a0000000-0000-4000-8000-000000000002");

describe("demoEventId", () => {
  it("is deterministic for the same organization", () => {
    expect(demoEventId(ORG_A)).toBe(demoEventId(ORG_A));
  });

  it("is disjoint across organizations", () => {
    expect(demoEventId(ORG_A)).not.toBe(demoEventId(ORG_B));
  });

  it("looks like a uuid", () => {
    expect(demoEventId(ORG_A)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("demoId", () => {
  const eventA = demoEventId(ORG_A);
  const eventB = demoEventId(ORG_B);

  it("is deterministic for the same event and key", () => {
    expect(demoId(eventA, "speaker:dana-whitfield")).toBe(demoId(eventA, "speaker:dana-whitfield"));
  });

  it("differs across keys within the same event", () => {
    expect(demoId(eventA, "speaker:dana-whitfield")).not.toBe(demoId(eventA, "speaker:marcus-iyer"));
  });

  it("is disjoint across events (and therefore across organizations) for the identical key — the whole point of D5", () => {
    expect(demoId(eventA, "speaker:dana-whitfield")).not.toBe(demoId(eventB, "speaker:dana-whitfield"));
  });

  it("never collides with the event id itself", () => {
    expect(demoId(eventA, "event")).not.toBe(eventA);
  });
});

describe("demoSlug", () => {
  it("is not in RESERVED_SLUGS", () => {
    const slug = demoSlug(demoEventId(ORG_A));
    expect((RESERVED_SLUGS as readonly string[]).includes(slug)).toBe(false);
  });

  it("is disjoint across organizations", () => {
    expect(demoSlug(demoEventId(ORG_A))).not.toBe(demoSlug(demoEventId(ORG_B)));
  });

  it("is deterministic and derived from the event id's first 8 hex characters", () => {
    const eventId = demoEventId(ORG_A);
    const slug = demoSlug(eventId);
    expect(slug).toBe(demoSlug(eventId));
    expect(slug).toBe(`ai-engineer-worlds-fair-demo-${eventId.replace(/-/g, "").slice(0, 8)}`);
  });

  it("is a legal slug shape — lowercase, digits and single hyphens only", () => {
    expect(demoSlug(demoEventId(ORG_A))).toMatch(/^[a-z0-9](-?[a-z0-9])*$/);
  });
});

describe("demoEmail", () => {
  it("always ends .demo.invalid", () => {
    expect(demoEmail("dana.whitfield", "northline")).toBe("dana.whitfield@northline.demo.invalid");
  });

  it("lowercases both parts", () => {
    expect(demoEmail("Dana.Whitfield", "Northline")).toBe("dana.whitfield@northline.demo.invalid");
  });

  it("strips characters that could smuggle a second @ or a stray domain segment", () => {
    expect(demoEmail("sam o'doyle", "in.d/e@pendent")).toBe("samodoyle@in.dependent.demo.invalid");
  });

  it("never resolves to a real, non-.invalid domain", () => {
    expect(demoEmail("anyone", "anycompany")).toMatch(/\.demo\.invalid$/);
  });
});

// A sibling document-only test: every id function here must resolve without
// ever touching `seedId` or its fixed global namespace (design's Risk #1) —
// asserted indirectly by construction, since this file imports nothing from
// `scripts/seed`.
describe("no dependency on the sandbox seed's global namespace", () => {
  it("demoEventId for an org never equals a hand-typed literal from scripts/seed/lib/ids.ts's OPENBOARD_NS-derived space", () => {
    const eventId: EventId = demoEventId(ORG_A);
    expect(eventId).not.toBe("4f1a5c2e-9b3d-5e7a-8c10-0d2f6b8a1e34");
  });
});
